---
name: numerical-verification
description: Verify simulations and numerical results before trusting them - analytic limits, conservation laws, convergence and refinement studies, manufactured solutions, independent cross-checks, error bars and pytest tolerances.
---

# Numerical Verification

A number that came out of a solver is a hypothesis, not a result. Apply the checks below, write the ones that matter as tests, and only then say what the result is and how much to trust it. This skill complements `scientific-computing` (how to compute) and `data-analysis` (how to fit).

## Guidelines

1. **Never Declare "Correct" Without an Independent Check**:
   - Before reporting any numerical result, run at least one check from sections 2 to 7 that does not reuse the code path being verified. "It ran without errors" and "the plot looks reasonable" are not checks.
   - State in the reply which checks were performed, their measured discrepancy, and which were not performed.

2. **Recover Known Analytic Solutions and Limits**:
   - Run the solver on the simplest configuration with a closed-form answer (harmonic oscillator, free particle, Poiseuille flow, 1-D heat kernel, hydrogen ground state, Kepler orbit) and compare with `numpy.testing.assert_allclose(numeric, exact, rtol=..., atol=...)`.
   - Check limiting regimes: small parameter to zero (perturbative limit), large time (steady state), large distance (far field), low temperature, non-relativistic ($v \ll c$) and classical ($\hbar \to 0$) limits. Confirm the numerical result approaches the known limit at the expected rate.
   - Use `sympy` to derive the exact solution when it is not memorised, and verify the SymPy result by substitution before using it as the reference.

3. **Symmetries and Conservation Laws**:
   - Identify every conserved quantity of the model - energy, linear and angular momentum, mass, charge, probability norm ($\int |\psi|^2 = 1$), phase-space volume - and compute it at every output step.
   - Quantify drift as a relative number: `max(abs(E - E[0])) / abs(E[0])` over the run. Report it. For symplectic integrators expect bounded oscillation; for RK-type integrators expect secular growth that shrinks with `rtol`.
   - Test invariances directly: translate or rotate the initial condition, flip the sign of time for a reversible system, swap identical particles, and assert the observable is unchanged to tolerance.
   - A conserved quantity that drifts monotonically at a rate independent of step size indicates a bug (wrong sign, missing term, boundary leak), not discretisation error.

4. **Convergence and Refinement Studies**:
   - Run the same problem at three or more resolutions halving $h$ (grid spacing, time step, basis size, number of samples) and record a scalar quantity of interest $Q(h)$.
   - Compute the observed order of accuracy from three levels: $p = \log_2\big(\lvert Q_{4h} - Q_{2h}\rvert / \lvert Q_{2h} - Q_h\rvert\big)$. Compare with the expected order (Euler 1, RK4 4, central differences 2, Simpson 4). A mismatch means a bug, a non-smooth solution, or being outside the asymptotic range.
   - Richardson-extrapolate the converged value, $Q_\infty \approx Q_h + (Q_h - Q_{2h}) / (2^p - 1)$, and use $\lvert Q_\infty - Q_h\rvert$ as the discretisation error estimate in the report.
   - For adaptive solvers (`solve_ivp`), tighten `rtol`/`atol` by factors of 10 and confirm the answer stabilises to the digits you intend to quote.
   - For iterative and Monte Carlo methods, plot the error against iteration count or $N$ on log axes and confirm the slope ($N^{-1/2}$ for Monte Carlo).

5. **Method of Manufactured Solutions (MMS)**:
   - Choose a smooth analytic function $u_m(x, t)$ (products of sines, exponentials, polynomials) that exercises every term of the PDE, substitute it into the operator with SymPy to obtain the source term $f = \mathcal{L}[u_m]$, then solve $\mathcal{L}[u] = f$ numerically with boundary and initial data taken from $u_m$.
   - Measure the error norm $\lVert u - u_m\rVert_2$ across refinements and confirm the observed order matches the scheme. MMS is the only way to verify a PDE code whose real solution is unknown.

6. **Cross-Check With an Independent Method or Library**:
   - Reproduce the key number with a different algorithm or package: `quad` vs `simpson` on a fine grid, `solve_ivp` with `'DOP853'` vs `'Radau'`, dense `numpy.linalg.eigh` vs sparse `eigsh`, a hand-written finite-difference scheme vs `solve_bvp`, SymPy closed form vs numeric, Python vs a Julia/R/Octave re-implementation via `run_command`.
   - Agreement between two methods that share the same discretisation or the same buggy input is not independent. Vary what could be wrong.
   - Delegate a from-scratch re-implementation to `spawn_agent` with only the problem statement (not your code) so the second implementation is genuinely independent.

7. **Sanity Bounds and Dimensional Checks**:
   - Assert physical bounds in code: probabilities in $[0, 1]$, temperatures and densities non-negative, speeds below $c$, eigenvalues of a Hermitian matrix real, correlation coefficients in $[-1, 1]$, a variational energy above the exact ground state.
   - Check orders of magnitude against a back-of-the-envelope estimate before trusting the digits; a result off by $10^3$ usually means a unit error (eV vs J, cm vs m, degrees vs radians).
   - Run the calculation with all inputs scaled (double every length, or change the unit system) and confirm the dimensionless outputs are unchanged.

8. **Statistical Results Need Seeds, Sample Sizes and Error Bars**:
   - Every stochastic result is reported as mean and standard error with the number of samples: `mean ± std/sqrt(N)` or a bootstrap interval (`scipy.stats.bootstrap`). Never report a Monte Carlo number without $N$.
   - Repeat the run with at least three different seeds from `numpy.random.default_rng(seed)`; if results scatter beyond the quoted error bar, the error estimate is wrong (correlated samples - compute the autocorrelation time or use block averaging).
   - Verify the estimator on a case with a known answer (e.g. $\pi$ from random points, a Gaussian integral) at the same $N$ before applying it to the real problem.

9. **Write Checks as pytest Tests With Explicit Tolerances**:
   - Put verification in `tests/test_verification.py` and run with `run_tests` or `run_command pytest -q`. Each test asserts with `numpy.testing.assert_allclose(actual, expected, rtol=R, atol=A)` where `R`/`A` come from the method's error, not from what makes the test pass: for a 4th-order scheme at $h$ use `rtol ~ C h^4` measured in the refinement study; for `solve_ivp` use a few times the requested `rtol`; for Monte Carlo use 3-5 standard errors.
   - Use `atol` for quantities that should be zero (conserved-quantity drift, residuals) and `rtol` for finite quantities. Setting `atol=1e-8` on a quantity of size $10^{-10}$ tests nothing.
   - Mark slow refinement studies with `@pytest.mark.slow` and keep a fast tier that runs in under a minute; parametrise resolutions with `@pytest.mark.parametrize`.
   - Add a regression test that pins the current answer with a tight tolerance so future changes that alter the result are caught deliberately.

10. **Diagnose Failures Systematically**:
    - When a check fails, halve the problem: single term, single time step, single grid cell, one particle. Print the residual of the discretised equation directly.
    - Compare against the analytic derivative or Jacobian with `scipy.optimize.check_grad` or a central-difference stencil before blaming the solver.
    - Confirm the solver flag (`sol.success`, `sol.status`, `ier`) and the reported number of function evaluations; an integrator that hit `max_step` or a root finder that stopped at its iteration cap has not converged.

11. **Report Residual Uncertainty Honestly**:
    - Give the result with the discretisation error from the refinement study, the statistical error if stochastic, and the tolerance used. Distinguish numerical error from model error (assumptions in the equations), and say which dominates.
    - List explicitly what was verified (with numbers: "energy drift $3\times10^{-9}$ over $10^4$ periods", "observed order 3.97") and what was not ("no MMS run; boundary treatment unverified at the corners").
    - If a check could not be completed, say so rather than omitting it. A result with a documented untested assumption is more useful than one presented as certain.
