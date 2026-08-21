We thank both referees for reports that were detailed and, in the case of the
error budget, plainly right. The revision is stronger for them. Below we answer
every point in turn; referee text is quoted from
`rounds/r2-nature/reviewers/`, which holds it verbatim, and each reply
names the point it answers so that nothing can go missing from the numbering.

# Reviewer 1

@point:r1.1 — We thank the reviewer for the careful reading, and we agree that
the error budget was the gap. It is now the first thing the revision fixes.

@point:r1.2 — We agree, and this was the most important change. We now propagate
the uncertainties on the ICM density, the relative velocity and both
surface-density profiles through the stripping condition by Monte Carlo, and
report the stripping radius as $8.4^{+2.1}_{-1.6}\,\mathrm{kpc}$. The Discussion
states explicitly that the outside-in interpretation holds across the full
interval: even at the upper end, the inner disk remains inside the stripping
radius.

@point:r1.3 — The referee is right that the line-of-sight velocity is a lower
limit. We now say so where the velocity is introduced, and note that a
statistical deprojection by $\sqrt{3}$ would raise the ram pressure by a factor
of three and push the stripping radius inward. Our quoted radius is therefore
conservative with respect to this bias.

@point:r1.4 — We have re-derived the comparison sample's stellar masses on the
same calibration used for the cluster members, and the offset persists. The
revised panel b shows the matched sample, and the systematic difference between
the two calibrations is quoted in the caption so that a reader can see the
offset exceeds it. *(Drafted; the matched catalogue is still being regenerated.)*

@point:r1.5 — **We respectfully disagree, and have made the distinction explicit
rather than softening the claim.** Jachym et al. (2019) is cited as evidence
that molecular gas *can* survive within a stripped tail — a statement about the
physics of the surviving phase, not about the ICM pressure at which stripping
begins. The extrapolation the referee is concerned about is one we do not make.
The Discussion now says this in one sentence and no longer implies that the
$z = 0$ pressures carry over.

@point:r1.6 — Added. The colour bar is now annotated with the systemic velocity
of $1450\,\mathrm{km\,s^{-1}}$, and the tick at that value is labelled.

@point:r1.7 — Corrected. The centroid is now quoted as $6563\,\mathrm{\AA}$ in
Table 1, consistent with the fitted line width.

@point:r1.8 — Moderated. The sentence now reads that the galaxy is "consistent
with" the outside-in quenching regime.

# Reviewer 2

@point:r2.1 — We thank the referee for the kind words on the figures, and we
have taken the reproducibility points seriously: the fit setup is now documented
rather than merely traceable.

@point:r2.2 — We have derived the timescale rather than removing the claim. The
crossing time implied by the stripping condition at the stripping radius is now
quoted in the Results, and the abstract names that number instead of the vaguer
phrase. *(Drafted; awaiting the final number from the re-run.)*

@point:r2.3 — A fit-setup table has been added to the supplement, listing each
parameter as free or fixed together with its bounds. `analysis/fit_spectrum.py`
writes those bounds into `results/spectrum_fit.json`, so the table is generated
rather than transcribed.

@point:r2.5 — Specified: we use the mass-quenching relation of Peng et al.
(2010, their equation 20), evaluated at the cluster redshift. This is now named
in the Discussion rather than left to the reader.

@point:r2.6 — Fixed; the abbreviation is expanded at first use only.
