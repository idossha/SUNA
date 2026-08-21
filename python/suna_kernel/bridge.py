"""Jupyter kernel bridge: one line of JSON in, one line of JSON out.

Why a Python process in the middle at all. Talking to a Jupyter kernel means
speaking the ZMQ wire protocol with HMAC-signed multipart messages. Doing
that from Electron would mean a native `zeromq` addon compiled against the
exact Electron ABI -- a rebuild step that breaks on every Electron bump, on a
platform matrix, for a feature that is meant to be optional.

`jupyter_client` already implements all of it, correctly, in pure Python, and
it is the same library Jupyter Lab and VS Code drive their kernels with. So
SUNA runs THIS script under the project's selected interpreter and speaks to
it over plain stdin/stdout pipes. No native Node dependency exists, the
kernel is a real Jupyter kernel (any language with a kernelspec, not just
Python), and the whole integration is a few hundred lines of protocol
translation.

Requests (one JSON object per line on stdin):
    {"id": "r1", "op": "execute", "code": "..."}
    {"id": "r2", "op": "interrupt"}
    {"id": "r3", "op": "restart"}
    {"id": "r4", "op": "shutdown"}

Events (one JSON object per line on stdout):
    {"type": "ready",   "kernel": {...}}
    {"type": "status",  "state": "busy"|"idle"|"starting"|"dead"}
    {"type": "input",   "reqId": "r1", "executionCount": 3}
    {"type": "output",  "reqId": "r1", "output": {<nbformat output>}}
    {"type": "reply",   "reqId": "r1", "status": "ok"|"error"|"abort",
                        "executionCount": 3}
    {"type": "fatal",   "message": "..."}

stdout carries protocol and nothing else; anything the bridge wants to say to
a human goes to stderr, which the main process logs.
"""

from __future__ import annotations

import json
import queue
import sys
import threading
from typing import Any

# Kernel output arrives on iopub keyed by the message it answers. These are
# the iopub message types that become nbformat outputs, verbatim: the content
# of an iopub 'stream'/'display_data'/'execute_result'/'error' message IS an
# nbformat output once 'output_type' is added, which is why the notebook file
# and the live kernel need no translation layer between them.
OUTPUT_MSG_TYPES = {"stream", "display_data", "execute_result", "error", "update_display_data"}


def emit(event: dict[str, Any]) -> None:
    """One event, one line, flushed -- the renderer is streaming these."""
    sys.stdout.write(json.dumps(event, ensure_ascii=False) + "\n")
    sys.stdout.flush()


def note(message: str) -> None:
    sys.stderr.write(f"[suna-kernel] {message}\n")
    sys.stderr.flush()


def output_from_msg(msg_type: str, content: dict[str, Any]) -> dict[str, Any] | None:
    """An iopub message as the nbformat output it will be stored as."""
    if msg_type == "stream":
        return {
            "output_type": "stream",
            "name": content.get("name", "stdout"),
            "text": content.get("text", ""),
        }
    if msg_type in ("display_data", "update_display_data"):
        return {
            "output_type": "display_data",
            "data": content.get("data", {}),
            "metadata": content.get("metadata", {}),
        }
    if msg_type == "execute_result":
        return {
            "output_type": "execute_result",
            "data": content.get("data", {}),
            "metadata": content.get("metadata", {}),
            "execution_count": content.get("execution_count"),
        }
    if msg_type == "error":
        return {
            "output_type": "error",
            "ename": content.get("ename", ""),
            "evalue": content.get("evalue", ""),
            "traceback": content.get("traceback", []),
        }
    return None


class Bridge:
    def __init__(self, kernel_name: str, cwd: str | None) -> None:
        from jupyter_client.manager import KernelManager

        self.manager = KernelManager(kernel_name=kernel_name)
        self.manager.start_kernel(cwd=cwd)
        self.client = self.manager.client()
        self.client.start_channels()
        self.client.wait_for_ready(timeout=60)
        # msg_id of an execute_request -> the renderer's request id, so every
        # output can be attributed to the cell that asked for it even while
        # several cells are queued.
        self.pending: dict[str, str] = {}
        self.lock = threading.Lock()
        self.stopping = threading.Event()

    def describe(self) -> dict[str, Any]:
        spec = self.manager.kernel_spec
        return {
            "name": self.manager.kernel_name,
            "displayName": getattr(spec, "display_name", self.manager.kernel_name),
            "language": getattr(spec, "language", ""),
        }

    def req_id_for(self, parent: dict[str, Any]) -> str | None:
        parent_id = parent.get("msg_id")
        if parent_id is None:
            return None
        with self.lock:
            return self.pending.get(parent_id)

    def pump_iopub(self) -> None:
        while not self.stopping.is_set():
            try:
                msg = self.client.get_iopub_msg(timeout=0.2)
            except queue.Empty:
                continue
            except Exception as error:  # channel closed during shutdown
                if not self.stopping.is_set():
                    note(f"iopub channel ended: {error}")
                return
            msg_type = msg["header"]["msg_type"]
            content = msg.get("content", {})
            if msg_type == "status":
                emit({"type": "status", "state": content.get("execution_state", "idle")})
                continue
            req_id = self.req_id_for(msg.get("parent_header", {}))
            if req_id is None:
                # Output with no cell to attribute it to (a background thread,
                # or something another client asked for). Dropping it is
                # better than pinning it to whichever cell ran last.
                continue
            if msg_type == "execute_input":
                emit(
                    {
                        "type": "input",
                        "reqId": req_id,
                        "executionCount": content.get("execution_count"),
                    }
                )
                continue
            if msg_type == "clear_output":
                emit({"type": "clear", "reqId": req_id, "wait": content.get("wait", False)})
                continue
            if msg_type in OUTPUT_MSG_TYPES:
                output = output_from_msg(msg_type, content)
                if output is not None:
                    emit({"type": "output", "reqId": req_id, "output": output})

    def pump_shell(self) -> None:
        while not self.stopping.is_set():
            try:
                msg = self.client.get_shell_msg(timeout=0.2)
            except queue.Empty:
                continue
            except Exception as error:
                if not self.stopping.is_set():
                    note(f"shell channel ended: {error}")
                return
            if msg["header"]["msg_type"] != "execute_reply":
                continue
            parent_id = msg.get("parent_header", {}).get("msg_id")
            with self.lock:
                req_id = self.pending.pop(parent_id, None) if parent_id else None
            if req_id is None:
                continue
            content = msg.get("content", {})
            emit(
                {
                    "type": "reply",
                    "reqId": req_id,
                    "status": content.get("status", "ok"),
                    "executionCount": content.get("execution_count"),
                }
            )

    def execute(self, req_id: str, code: str) -> None:
        msg_id = self.client.execute(code, store_history=True, allow_stdin=False)
        with self.lock:
            self.pending[msg_id] = req_id

    def interrupt(self) -> None:
        self.manager.interrupt_kernel()

    def restart(self) -> None:
        with self.lock:
            self.pending.clear()
        self.manager.restart_kernel(now=False)
        self.client.wait_for_ready(timeout=60)
        emit({"type": "ready", "kernel": self.describe()})

    def shutdown(self) -> None:
        self.stopping.set()
        try:
            self.client.stop_channels()
            self.manager.shutdown_kernel(now=False)
        except Exception as error:
            note(f"shutdown: {error}")


def main() -> int:
    kernel_name = sys.argv[1] if len(sys.argv) > 1 else "python3"
    cwd = sys.argv[2] if len(sys.argv) > 2 else None

    try:
        import jupyter_client  # noqa: F401
    except ImportError:
        # The one failure the author can actually fix, so it says how.
        emit(
            {
                "type": "fatal",
                "code": "no-jupyter-client",
                "message": (
                    "This environment has no jupyter_client. Install the notebook "
                    "runtime into it with:  pip install ipykernel"
                ),
            }
        )
        return 1

    try:
        bridge = Bridge(kernel_name, cwd)
    except Exception as error:
        name = type(error).__name__
        code = "no-kernelspec" if name == "NoSuchKernel" else "start-failed"
        message = (
            f"No kernel named {kernel_name!r} is installed in this environment. "
            "Install one with:  pip install ipykernel"
            if code == "no-kernelspec"
            else f"Could not start the kernel: {error}"
        )
        emit({"type": "fatal", "code": code, "message": message})
        return 1

    emit({"type": "ready", "kernel": bridge.describe()})
    threading.Thread(target=bridge.pump_iopub, daemon=True).start()
    threading.Thread(target=bridge.pump_shell, daemon=True).start()

    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        try:
            request = json.loads(line)
        except json.JSONDecodeError as error:
            note(f"ignoring unparseable request: {error}")
            continue
        op = request.get("op")
        req_id = request.get("id", "")
        try:
            if op == "execute":
                bridge.execute(req_id, request.get("code", ""))
            elif op == "interrupt":
                bridge.interrupt()
            elif op == "restart":
                bridge.restart()
            elif op == "shutdown":
                break
            else:
                note(f"unknown op {op!r}")
        except Exception as error:
            emit({"type": "fatal", "code": "op-failed", "message": f"{op}: {error}"})

    bridge.shutdown()
    return 0


if __name__ == "__main__":
    sys.exit(main())
