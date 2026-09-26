---
name: research-writing
description: Writing technical reports, derivations, notebooks and papers in Markdown or LaTeX with correctly rendered equations, figures, tables, verifiable citations from web sources, and reproducible artifacts - precise, no overclaiming.
---

# Research Writing

Produce technical documents a reviewer could check: every equation derivable, every figure reproducible from a named script, every claim tied to a verification or a citation. Use this with `scientific-computing` and `numerical-verification` for the computations the document describes.

## Guidelines

1. **Structure Every Report the Same Way**:
   - Sections, in order: Problem statement; Assumptions and scope; Model / governing equations; Derivation (when there is one); Method (algorithm, discretisation, parameters, software versions); Results; Validation (what was checked, with numbers); Limitations; Reproduction instructions; References.
   - Lead with a 3-5 sentence summary stating the question, the method and the headline number with its uncertainty. A reader who stops there should not be misled.
   - Keep the body under what the reader needs; put long tables, extra plots and full parameter listings in an appendix or a `results/` directory referenced by path.

2. **Equations With KaTeX-Compatible LaTeX**:
   - In chat and `create_artifact` Markdown reports, write inline math as `$E = \tfrac{1}{2} m v^2$` and display math as `$$ ... $$` on its own lines. Number important equations by hand with `\tag{3}` since KaTeX has no automatic numbering.
   - Use only KaTeX-supported constructs: `\frac`, `\partial`, `\nabla`, `\hat`, `\vec`, `\mathbf`, `\langle \rangle`, `\begin{aligned}...\end{aligned}` for multi-line, `\begin{pmatrix}` for matrices, `\operatorname{}` for named functions. Avoid `\begin{equation}`, `\label`, `\eqref`, `\newcommand` spanning blocks and custom packages; they do not render in chat.
   - Define every symbol at first use and keep notation consistent across the document (one symbol per quantity, one quantity per symbol). Bold for vectors, upright for units: `$5.0\ \mathrm{m\,s^{-1}}$`.
   - Generate LaTeX for derived expressions with `sympy.latex(expr)` rather than retyping them, and reread the rendered result for lost braces.

3. **Derivations Are Numbered Steps With Justification**:
   - Present a derivation as a numbered list where each step shows the equation and names the operation that produced it ("substituting (2) into (1)", "expanding to first order in $\epsilon$", "integrating by parts, boundary term vanishes because $\psi \to 0$"). A step that cannot be named is a step the reader cannot check.
   - State the assumptions used at the step where they are used, not only in the introduction.
   - After the final expression, give the checks performed: dimensional consistency, a limiting case that recovers a known formula, and, when SymPy was used, that back-substitution returned zero.
   - Do not hide algebra behind "it can be shown"; either show it, defer it to an appendix, or cite where it is shown.

4. **Figures**:
   - Every figure is produced by a named script (`scripts/plot_dispersion.py`) and saved to `results/<name>.png` (plus `.pdf` for LaTeX); reference the path in the document and in the caption.
   - Captions are complete sentences that say what is plotted, against what, with units and the parameter values used, and name the analytic reference curve if one is overlaid. A figure should be understandable from its caption alone.
   - Before referencing a figure, open it with `view_image` and confirm it shows what the text claims. Never describe a figure from memory of the code.
   - In Markdown use `![caption](results/name.png)`; in LaTeX use `\begin{figure}` with `\includegraphics[width=0.8\linewidth]{}`, `\caption{}` and `\label{fig:}`, referenced with `\ref` or `\cref`.

5. **Tables**:
   - Use tables for parameter sets, comparisons of methods and numerical results with uncertainties. Columns carry units in the header: `| $T$ (K) | $\kappa$ (W m$^{-1}$ K$^{-1}$) |`.
   - Quote numbers to the precision justified by their uncertainty (write `1.23 ± 0.04`, not `1.2345 ± 0.0412`) and align decimal points. In LaTeX use `booktabs` (`\toprule`, `\midrule`, `\bottomrule`) and `siunitx` `S` columns.
   - Generate tables from the results data with `pandas.DataFrame.to_markdown()` or `.to_latex()` so the document and the data cannot disagree.

6. **Citations From Real Sources Only**:
   - Cite only sources you have actually retrieved with `web_search` / `fetch_url` or that the user supplied. Never invent a reference, a DOI, a page number or an author list; never cite from memory without verifying that the document exists and says what you attribute to it.
   - Every citation includes a URL or DOI. Prefer the primary source (paper, standard, documentation page) over a blog summarising it. Record the access date for web pages.
   - In Markdown use numbered references `[1]` with a References list of `Author(s), Title, Venue, Year, URL`. In LaTeX use a `.bib` file with `\cite{}` and `biblatex` or `natbib`.
   - Distinguish between what a source states and your interpretation of it. When sources disagree, say so rather than picking one silently.
   - Use `spawn_agent` for literature searches that would flood the main context; ask it to return title, authors, year, URL and a one-sentence relevance note per source.

7. **LaTeX Projects**:
   - Layout: `main.tex`, `sections/*.tex` included with `\input`, `figures/`, `references.bib`, and a `Makefile` or `latexmkrc`. Compile with `run_command latexmk -pdf -interaction=nonstopmode main.tex` when `latexmk` is available (falls back to `pdflatex` twice plus `bibtex`/`biber`).
   - Load `amsmath`, `amssymb`, `graphicx`, `booktabs`, `siunitx`, `hyperref` and `cleveref`. Use `\SI{2.5}{\metre\per\second}` / `\qty` for values with units.
   - Read the `.log` after compiling and fix every `Undefined reference`, `Citation undefined`, `Overfull \hbox` above 10 pt and missing-file warning before declaring the build clean. Do not deliver a PDF whose citations render as `[?]`.
   - Keep the PDF out of version control; commit sources and figures.

8. **Notebooks as Narrative Documents**:
   - When the deliverable is a notebook, alternate Markdown cells (question, equations, interpretation) with short code cells. Each code cell does one thing and its output is discussed in the following Markdown cell.
   - Build it with `notebook_edit`, execute with `run_notebook`, and verify with `read_file` that every cell has run in order with no error outputs and no stale numbers. Restart-and-run-all is the standard; a notebook that only works with hidden state is not reproducible.
   - Pin the random seed and the library versions in the first cell; write final numbers to `results/` so the report can cite them without rerunning.

9. **Reproduction Instructions**:
   - End every report with the exact commands to regenerate its results from a clean checkout: environment setup (`pip install -r requirements.txt` or `uv sync`), the scripts in order, expected runtime, and the seed. Test these commands yourself with `run_command` before including them.
   - Name the software versions (`python`, `numpy`, `scipy`, compiler) and the machine class if runtime matters. Store parameters in a config file referenced by the document, not only in prose.
   - Deliver persistent reports with `create_artifact` so they survive the chat; keep the Markdown source in the workspace (`docs/report.md`) as well.

10. **Precision in Language, No Overclaiming**:
    - Separate what was computed, what was verified and what is conjectured. Use "we verified X to within Y" only when a check from `numerical-verification` was actually run; otherwise write "not verified".
    - Quantify: replace "good agreement" with "agrees to 0.3 % over $0 < t < 10$", replace "converges" with the observed order and the extrapolated value.
    - Write the Limitations section as a list of concrete conditions under which the result does not hold (regime, neglected physics, resolution, sample size), not as a generic disclaimer.
    - Avoid "clearly", "obviously", "it is well known", and passive claims with no agent ("it was found"). State who or what found it and how.
    - Before delivery, reread the summary and check that every number in it appears, with the same value and uncertainty, in the Results section.
