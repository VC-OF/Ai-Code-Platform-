---
name: scientific-computing
description: Numerical and symbolic computing workflow for physics, maths and engineering - modelling, dimensional analysis, units, NumPy/SciPy/SymPy method choice, floating-point hygiene, reproducible layout and plotting standards.
---

# Scientific Computing

Solve quantitative problems the way a careful computational physicist would: state the model before touching code, choose numerical methods deliberately, validate against something known, and report results with their limits of validity. Pair this skill with `numerical-verification` before calling any result correct and with `research-writing` when the deliverable is a report.

## Guidelines

1. **State the Problem Before Computing**:
   - Write down, in the reply or a `README.md`, the physical system, governing equations, unknowns, boundary/initial conditions and every assumption (linear, isothermal, non-relativistic, small angle). Use `$...$` / `$$...$$` LaTeX in chat.
   - Identify what quantity is actually asked for and to what precision. Do not compute a 6-digit answer for a model with 10 % assumptions.
   - If the problem is under-specified (missing parameter, unit or regime), ask one precise question or state the assumption explicitly and continue.

2. **Dimensional Analysis and Nondimensionalisation First**:
   - Check every equation for dimensional consistency before implementing it; a mismatch is a modelling bug, not a numerical one.
   - Nondimensionalise: pick characteristic scales ($L$, $T$, $M$, $E$), form the dimensionless groups (Reynolds, Péclet, $\hbar\omega/k_BT$ ...) and solve in scaled variables. This avoids $10^{-34}$ multiplying $10^{23}$ and exposes the small parameters that control regime validity.
   - Convert back to SI only at the reporting stage, and print the scales used.

3. **Units Are Explicit**:
   - Use SI internally. When `pint` is installed, build quantities with `ureg.Quantity(value, 'm/s')`, compute in-unit and call `.to('km/h')` / `.to_base_units()` at the boundary; call `.magnitude` only when handing arrays to SciPy.
   - When `pint` is unavailable, name variables with their unit suffix (`t_s`, `E_eV`, `B_T`) and take constants from `scipy.constants` (`c`, `hbar`, `k`, `e`, `physical_constants['electron mass']`) instead of typing them.
   - Never mix CGS and SI in one script; Gaussian units need a stated note.

4. **Choose the Method Deliberately**:
   - ODE initial-value problems: `scipy.integrate.solve_ivp`. Use `method='RK45'` or `'DOP853'` for smooth non-stiff systems, `'Radau'` or `'BDF'` (or `'LSODA'` to auto-detect) when the system is stiff - symptoms are tiny accepted steps, thousands of evaluations or a warning about step size. Always pass `rtol` and `atol` explicitly (defaults `1e-3`/`1e-6` are loose for physics); set `dense_output=True` for interpolation and `events=` for zero crossings.
   - Hamiltonian / long-time orbital dynamics: use a symplectic integrator (velocity Verlet, leapfrog) and monitor energy drift; RK45 accumulates secular energy error.
   - Boundary-value problems: `scipy.integrate.solve_bvp`; eigenproblems: `scipy.linalg.eigh` for Hermitian, `scipy.sparse.linalg.eigsh` for large sparse (shift-invert `sigma=` near the wanted eigenvalue).
   - Quadrature: `scipy.integrate.quad` for 1-D smooth integrands (pass `points=` for known kinks, `limit=` higher for oscillatory), `quad_vec` for vector-valued, `dblquad`/`nquad` for low dimension, `scipy.integrate.simpson` on tabulated data, and Monte Carlo (`numpy.random.default_rng`) only above ~4 dimensions.
   - Root finding: `scipy.optimize.brentq` with a bracketing interval when the function changes sign (robust), `newton` only with a good starting guess and preferably an analytic derivative, `fsolve`/`root(method='hybr')` for systems. Check `sol.success` and the residual `abs(f(root))`.
   - Optimisation: `scipy.optimize.minimize` with `method='L-BFGS-B'` for smooth bounded problems, `'Nelder-Mead'` for noisy objectives, `least_squares` for residual fitting. Restart from several initial points before claiming a global minimum.
   - PDEs: finite differences with explicit stability limits (CFL: $\Delta t \le C\,\Delta x / v$, diffusion: $\Delta t \le \Delta x^2 / (2D)$) or spectral methods (`numpy.fft`) for periodic smooth problems. State scheme, order and stability condition in a comment.

5. **Floating-Point and Conditioning Hygiene**:
   - Never compare floats with `==`; use `numpy.isclose` / `math.isclose` with a tolerance derived from the method.
   - Avoid catastrophic cancellation: use `numpy.expm1`, `numpy.log1p`, `numpy.hypot`, `scipy.special.logsumexp` and stable quadratic formulas; sum long series with `math.fsum` or Kahan when precision matters.
   - Check `numpy.linalg.cond(A)` before solving; if it exceeds ~$10^{12}$ in double precision the solution is unreliable. Prefer `numpy.linalg.solve(A, b)` / `scipy.linalg.lu_solve` to `inv(A) @ b`, `lstsq` for over-determined systems and `scipy.linalg.solve_banded` / sparse solvers for structured matrices.
   - Use `float64` by default; `float32` only for memory-bound GPU work, never for accumulated sums. Use `mpmath` when a derivation demands more digits.
   - Seed every stochastic computation with `numpy.random.default_rng(seed)` passed as an argument, never via global state.

6. **Vectorise, Then Profile**:
   - Write array expressions over Python loops; use `numpy.einsum` for tensor contractions, broadcasting for grids (`numpy.meshgrid(..., indexing='ij')`), and `scipy.sparse` for mostly-zero matrices.
   - Measure before optimising: `python -m cProfile -s cumtime script.py` via `run_command`. Use `numba.njit` only for tight scalar loops that cannot be vectorised; compiled C/C++/Fortran only when the Docker sandbox is available.

7. **Symbolic Work with SymPy**:
   - Declare symbols with assumptions (`sympy.symbols('x', real=True, positive=True)`) - without them `sqrt(x**2)` will not simplify to `x`.
   - Derive with `diff`, `integrate`, `series`, `solve`/`solveset`, `dsolve`; simplify with the targeted functions (`trigsimp`, `expand`, `factor`, `cancel`, `collect`, `nsimplify`) rather than the slow general `simplify`.
   - Check every derived expression by substitution: plug the solution back into the original equation and confirm `simplify(lhs - rhs) == 0`, or evaluate both sides numerically at random points with `evalf`.
   - Convert to fast numerics with `sympy.lambdify(args, expr, 'numpy')` (or `'scipy'` for special functions) and spot-check the lambdified function against `expr.subs(...).evalf()` at one point.
   - Print results with `sympy.latex(expr)` so they paste directly into the chat or a report.

8. **Quick Experiments with `execute_code` and `view_image`**:
   - Use `execute_code` (Python) for exploratory calculations, parameter sweeps and throwaway plots; it runs in a scratch dir and any open matplotlib figure is saved as a PNG and reported back.
   - Open each returned PNG with `view_image` and inspect it: axis ranges, clipped curves, whether the expected asymptote appears. Do not describe a plot you have not looked at.
   - Promote scratch code into the project only after it works; keep the experiment itself out of the deliverable.

9. **Plotting Standards**:
   - Every axis has a label with units: `ax.set_xlabel('time $t$ (s)')`. Title or caption states what varies.
   - Use `ax.set_xscale('log')` / `set_yscale('log')` when data span more than two decades; use `loglog` to reveal power laws and annotate the fitted exponent.
   - Plot the analytic reference or expected limit on the same axes as the numerical result whenever one exists, with a legend.
   - One message per figure. Families of curves get a colormap with a labelled `fig.colorbar`, not eight unlabelled lines.
   - Save with `fig.savefig('results/name.png', dpi=150, bbox_inches='tight')`, plus `.pdf` if the figure goes into a paper.

10. **Project Layout and Reproducibility**:
    - Layout: `src/<package>/` for model and solvers, `scripts/` for entry points that produce results, `tests/` for pytest checks, `results/` for generated figures and data, `notebooks/` for narrative exploration.
    - Pin dependencies in `requirements.txt` or `pyproject.toml`; install with `pip`/`uv` via `run_command`. Record `numpy.__version__`, `scipy.__version__` and the seed in the results metadata.
    - Scripts are deterministic and argument-driven (`argparse`), write outputs to `results/` with parameters in the filename or a sidecar `.json`, and never depend on notebook state.
    - Save numerical results with `numpy.savez_compressed` or `.csv`, never only as a figure.

11. **Notebook vs Script**:
    - Use a notebook (`notebook_edit` + `run_notebook`, inspect with `read_file`) when the value is the narrative: exploring a dataset, a derivation next to its plot, teaching. Restart-and-run-all before delivering.
    - Use a script plus tests when the value is a reusable, parameterised computation, when runtimes are long, or when results feed a report. Long sweeps belong in a script with checkpointing.

12. **Validate and Report**:
    - Before reporting, run at least one check from `numerical-verification`: an analytic limit, a conservation law, or a refinement study.
    - Report the result with its numerical uncertainty, the regime in which the model holds, and what was not checked. Delegate long literature or cross-check work to `spawn_agent` so the main context stays on the computation.
