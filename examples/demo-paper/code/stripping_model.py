"""Ram-pressure stripping model for the demo cluster galaxy.

Implements the classical Gunn & Gott (1972) criterion: gas at radius r is
stripped when the ram pressure exerted by the intracluster medium (ICM)
exceeds the gravitational restoring force per unit area of the disk,

    P_ram = rho_ICM * v^2  >  2 * pi * G * Sigma_star(r) * Sigma_gas(r).

Both surface-density profiles are taken to be exponential, so the criterion
has a closed-form solution for the stripping radius (see Binney & Tremaine
2008, ch. 8, for the restoring-force formalism):

    r_strip = ln(2 pi G Sigma_star0 Sigma_gas0 / P_ram)
              / (1/h_star + 1/h_gas)

The default parameters describe the demo galaxy of this example project and
yield the stripping radius quoted in the Results table (8.4 kpc). Run from
the project root:

    uv run --project ../../python/suna_mpl python code/stripping_model.py

Units: surface densities in Msun/pc^2, scale lengths in kpc, ICM electron
density in cm^-3, velocity in km/s. Internally everything is converted to
Msun, pc, km/s, in which G = 4.30091e-3 pc Msun^-1 (km/s)^2.
"""

import json
import math

# --- physical constants -----------------------------------------------------
G_PC_KMS2_MSUN = 4.30091e-3  # gravitational constant, pc (km/s)^2 / Msun
MSUN_G = 1.989e33  # solar mass in grams
PC_CM = 3.0857e18  # parsec in centimetres
MU_MP_G = 1.4 * 1.67262e-24  # mean ICM particle mass (mu = 1.4), grams

# --- demo-galaxy defaults (match data/ and the Results table) ---------------
DEFAULTS = {
    "n_icm_cm3": 1.0e-3,  # ICM electron density
    "v_kms": 1500.0,  # infall velocity
    "sigma_star0_msun_pc2": 2400.0,  # central stellar surface density
    "h_star_kpc": 3.5,  # stellar scale length
    "sigma_gas0_msun_pc2": 60.0,  # central gas surface density
    "h_gas_kpc": 5.5,  # gas scale length
}


def ram_pressure(n_icm_cm3: float, v_kms: float) -> float:
    """Ram pressure rho_ICM * v^2 in Msun (km/s)^2 pc^-3.

    Args:
        n_icm_cm3: ICM electron density in cm^-3.
        v_kms: galaxy velocity through the ICM in km/s.
    """
    rho_g_cm3 = n_icm_cm3 * MU_MP_G
    rho_msun_pc3 = rho_g_cm3 / (MSUN_G / PC_CM**3)
    return rho_msun_pc3 * v_kms**2


def restoring_pressure(
    r_kpc: float,
    sigma_star0_msun_pc2: float,
    h_star_kpc: float,
    sigma_gas0_msun_pc2: float,
    h_gas_kpc: float,
) -> float:
    """Restoring force per unit area 2 pi G Sigma_star(r) Sigma_gas(r).

    Returned in Msun (km/s)^2 pc^-3, for exponential stellar and gas disks.
    """
    sigma_star = sigma_star0_msun_pc2 * math.exp(-r_kpc / h_star_kpc)
    sigma_gas = sigma_gas0_msun_pc2 * math.exp(-r_kpc / h_gas_kpc)
    return 2.0 * math.pi * G_PC_KMS2_MSUN * sigma_star * sigma_gas


def stripping_radius_kpc(
    n_icm_cm3: float = DEFAULTS["n_icm_cm3"],
    v_kms: float = DEFAULTS["v_kms"],
    sigma_star0_msun_pc2: float = DEFAULTS["sigma_star0_msun_pc2"],
    h_star_kpc: float = DEFAULTS["h_star_kpc"],
    sigma_gas0_msun_pc2: float = DEFAULTS["sigma_gas0_msun_pc2"],
    h_gas_kpc: float = DEFAULTS["h_gas_kpc"],
) -> float:
    """Radius outside which the Gunn-Gott criterion strips the gas, in kpc.

    Closed-form solution of ram_pressure == restoring_pressure for
    double-exponential disks. Returns 0.0 when the whole disk is stripped
    (ram pressure exceeds the central restoring force) and math.inf when
    nothing is stripped.
    """
    p_ram = ram_pressure(n_icm_cm3, v_kms)
    p_restore0 = restoring_pressure(
        0.0, sigma_star0_msun_pc2, h_star_kpc, sigma_gas0_msun_pc2, h_gas_kpc
    )
    if p_ram >= p_restore0:
        return 0.0
    if p_ram <= 0.0:
        return math.inf
    return math.log(p_restore0 / p_ram) / (1.0 / h_star_kpc + 1.0 / h_gas_kpc)


def main() -> None:
    r_strip = stripping_radius_kpc()
    print(
        json.dumps(
            {
                "parameters": DEFAULTS,
                "ram_pressure_msun_kms2_pc3": round(
                    ram_pressure(DEFAULTS["n_icm_cm3"], DEFAULTS["v_kms"]), 4
                ),
                "stripping_radius_kpc": round(r_strip, 2),
            },
            indent=2,
        )
    )


if __name__ == "__main__":
    main()
