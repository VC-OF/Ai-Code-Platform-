---
name: data-analysis
description: Exploratory data analysis and statistics with pandas/NumPy/SciPy - loading, documented cleaning, curve fitting with uncertainties and goodness of fit, error propagation, hypothesis tests, visualisation and reporting.
---

# Data Analysis

Turn raw measurements or simulation output into defensible numbers: inspect before trusting, record every cleaning decision, fit with uncertainties, test with assumptions checked, and leave a script that regenerates everything. Use `numerical-verification` for the computations behind the data and `research-writing` for the write-up.

## Guidelines

1. **Load and Inspect Before Anything Else**:
   - Load with the explicit reader: `pandas.read_csv(path, sep=..., parse_dates=[...], na_values=[...])`, `read_parquet`, `numpy.loadtxt` for numeric grids, `scipy.io.loadmat` for MATLAB files, `h5py` for HDF5. Pass `dtype=` when a column must be numeric so string coercion fails loudly.
   - Run the inspection set every time: `df.shape`, `df.dtypes`, `df.describe(include='all')`, `df.isna().sum()`, `df.duplicated().sum()`, `df.nunique()`, and per-column `min`/`max` against physically plausible ranges. Report these in a short table before analysis.
   - Check for sentinel values (`-999`, `0` where zero is impossible), mixed units in one column, thousands separators read as strings, and timestamps without time zone.

2. **Tidy the Data**:
   - Reshape to one observation per row and one variable per column with `df.melt` / `df.pivot`. Keep the raw file untouched and write the tidy version to `data/processed/`.
   - Use `astype('category')` for factor columns and `pandas.to_datetime(utc=True)` for times. Set an index (`set_index('time')`) only when it is unique and sorted.

3. **Never Silently Drop or Impute - Record Decisions**:
   - Every row or value removed or filled is logged: how many, by which rule, and why. Keep a `cleaning_log` list in the pipeline script and print it; put the same list in the results summary.
   - Prefer flagging over deleting: add a boolean `is_outlier` column and filter at analysis time, so the decision is reversible.
   - Outliers are identified by a stated rule (physical bound, median ± 3 × MAD via `scipy.stats.median_abs_deviation`, instrument flag), never by "it looked wrong". Report results with and without excluded points when the exclusion changes the conclusion.
   - If imputation is required, state the method (`df.interpolate(method='time')`, group median) and re-run with rows dropped instead to show sensitivity.

4. **Descriptive Statistics and Visual Checks Before Modelling**:
   - Plot the raw data first: histograms (`ax.hist(x, bins='auto')`), scatter of each predictor against the response, `pandas.plotting.scatter_matrix` for many variables, and the time trace for anything sequential.
   - Inspect every produced figure with `view_image`; look for bimodality, saturation, clipping, digitisation steps and drift, which change the choice of model.
   - Report robust and classical summaries side by side (median/IQR and mean/std); large differences indicate skew or outliers.

5. **Curve Fitting With Uncertainties and Goodness of Fit**:
   - Use `scipy.optimize.curve_fit(f, x, y, p0=..., sigma=y_err, absolute_sigma=True)` when measurement errors are known; without `sigma` the covariance is scaled by the residual variance. Always provide `p0` from a physical estimate; check `popt` is not sitting at the initial guess.
   - Parameter uncertainties are `perr = numpy.sqrt(numpy.diag(pcov))`; report each parameter as `value ± perr` with units, and report strong correlations from the normalised covariance `pcov / numpy.outer(perr, perr)`.
   - Compute residuals `r = (y - f(x, *popt)) / y_err`, chi-square `chi2 = numpy.sum(r**2)`, degrees of freedom `dof = len(y) - len(popt)` and reduced chi-square `chi2 / dof`. A value far from 1 means the model is wrong (structured residuals) or the errors are mis-estimated; state which. Give the p-value from `scipy.stats.chi2.sf(chi2, dof)`.
   - Always produce a residual plot (residuals vs $x$ and a histogram of residuals). A good fit has residuals with no trend and no autocorrelation; check with `scipy.stats.shapiro` on residuals and a lag-1 autocorrelation.
   - For linear models use `numpy.polyfit(x, y, deg, cov=True)` or `scipy.stats.linregress` (slope, intercept, `stderr`, `intercept_stderr`, $r^2$). For heavy-tailed data use `scipy.optimize.least_squares(loss='soft_l1')`.
   - Power laws: fit in log-log space only if errors are multiplicative, otherwise fit the nonlinear model directly. Exponentials: use a linearised fit to get `p0`, then the nonlinear fit.
   - Compare competing models with AIC/BIC or an F-test on the chi-square difference, not by eye; report the number of parameters.

6. **Uncertainty Propagation**:
   - For $f(a, b, \ldots)$ with independent errors use $\sigma_f^2 = \sum_i (\partial f / \partial x_i)^2 \sigma_i^2$; compute the partials with SymPy or numerically. Include covariance terms from `pcov` when inputs come from the same fit.
   - When the function is nonlinear or errors are large, propagate by Monte Carlo: draw inputs from `rng.normal(mean, sigma, size=10000)` (or `rng.multivariate_normal(popt, pcov, size)`), evaluate, and report the 16th/84th percentiles.
   - The `uncertainties` package (`ufloat`) automates the linear case; use it when installed and note the linearisation assumption.

7. **Hypothesis Tests With Assumptions Checked and Effect Sizes**:
   - Before a parametric test, check what it assumes: normality (`scipy.stats.shapiro` for $n < 5000$, or a Q-Q plot via `scipy.stats.probplot`), equal variance (`scipy.stats.levene`), independence (by design, not a test).
   - Choose accordingly: `ttest_ind(equal_var=False)` (Welch) as the default two-sample test; `ttest_rel` for paired; `mannwhitneyu` / `wilcoxon` when normality fails; `chi2_contingency` or `fisher_exact` for counts; `pearsonr` / `spearmanr` for correlation; `f_oneway` / `kruskal` for more than two groups.
   - Always report an effect size with the p-value: Cohen's $d$, the correlation coefficient, the odds ratio, or the raw difference with a confidence interval (`scipy.stats.bootstrap` or `ttest_ind(...).confidence_interval()`). A tiny p-value with a negligible effect is not a finding.
   - State the sample size and, for planned experiments, the power (`statsmodels.stats.power` when available).

8. **Multiple Comparisons**:
   - When more than one test is run on the same data, control the family-wise or false-discovery rate: `statsmodels.stats.multitest.multipletests(pvals, method='holm')` or `'fdr_bh'`; if `statsmodels` is unavailable, apply Bonferroni explicitly. Report both raw and adjusted p-values and the number of tests performed.
   - Do not search over subsets, thresholds or transformations and then report only the significant one; if exploration happened, say so and treat the result as a hypothesis for new data.

9. **Time Series Basics**:
   - Ensure a regular sampling grid (`df.asfreq('1min')` after `set_index`) and record gaps; resample with `df.resample('1h').mean()` and state the aggregation.
   - Detrend before spectral analysis; use `scipy.signal.periodogram` / `welch` with a named window and report the frequency resolution $1/T$. Locate peaks with `scipy.signal.find_peaks(prominence=...)`.
   - Check stationarity (rolling mean/std plots) and autocorrelation (`pandas.Series.autocorr(lag)`) before tests that assume independent samples; use the effective sample size $N/(2\tau)$ for error bars.
   - Filter with `scipy.signal.butter` + `sosfiltfilt` (zero-phase); state cutoff and order. Never smooth before fitting unless the smoothing is part of the declared model.

10. **Plotting Standards**:
    - Show data as points with error bars (`ax.errorbar(x, y, yerr=..., fmt='o')`) and the fitted model as a line on a fine grid, with fitted parameters in the legend or caption.
    - Axes labelled with quantity and unit; log scales for quantities spanning decades; a residual panel beneath every fit plot (`plt.subplots(2, 1, sharex=True, height_ratios=[3, 1])`).
    - Deliverable figures are matplotlib with explicit styling. One message per figure; check each with `view_image` before describing it.

11. **Reproducible Pipeline and Results Summary**:
    - Keep one entry point, `scripts/analyze.py`, that reads raw data, applies the logged cleaning, fits, tests, writes `results/summary.json` (parameters, uncertainties, chi-square, p-values, effect sizes, N, seed, versions) and saves figures to `results/`. Run it end-to-end with `run_command` before reporting.
    - Use `execute_code` for exploration and `notebook_edit` / `run_notebook` for the narrative version; numbers quoted to the user come from `summary.json`, never from a scratch cell.
    - Write short `pytest` tests: the loader returns the expected columns and row count, the cleaning log matches expectations, and a synthetic dataset with known parameters is recovered by the fit within its reported uncertainty.

12. **Large Files**:
    - Inspect a sample first: `pandas.read_csv(path, nrows=10000)`; profile dtypes on the sample and pass them to the full read to cut memory.
    - Stream with `read_csv(chunksize=1_000_000)` aggregating per chunk, use `usecols=` for needed columns only, or convert once to Parquet. Use `polars` or `dask.dataframe` when installed and data exceed RAM; never load a multi-GB CSV blindly inside `execute_code`.
