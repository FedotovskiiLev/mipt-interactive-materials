# MIPT Physics Labs

Interactive educational tools for physics laboratory work at MIPT.

The project is built around a simple idea: laboratory software should help students understand the experiment and the data analysis, not replace the work itself. Each lab page combines concise theory, visual explanations, interactive calculations, and tools for working with real experimental data.

## Current Labs

### 1.1.4 — Statistics of Cosmic-Ray Background

An interactive companion for the laboratory on statistical analysis of cosmic-ray background measurements.

Main features:

- parsing of laboratory data files with `#` comments;
- calculation of the mean, variance, standard deviation, and uncertainty of the mean;
- counting-rate calculation;
- grouping measurements into larger time intervals;
- experimental histograms;
- comparison with the Poisson distribution;
- Gaussian approximation for larger mean counts;
- comparison of `σ_n` with `sqrt(<n>)`;
- visualization of sample-mean convergence;
- visualization of the `1/sqrt(N)` behavior of the uncertainty;
- interactive examples of Poisson, exponential, and Pareto distributions;
- short theory notes and self-check questions.

## Project Structure

```text
mipt-physics-labs/
├── index.html
├── README.md
└── lab-1.1.4/
    ├── index.html
    ├── styles.css
    ├── app.js
    └── sample_data.txt
```

Each laboratory is kept in its own directory:

```text
lab-X.X.X/
```

The root page serves as a common entry point for the collection.

## Data Format

The statistics lab accepts plain-text data with one numeric measurement per line.

Lines beginning with `#` are treated as comments and ignored.

Example:

```text
# measurement session
1
2
1
0
3
2
1
```

All processing is performed locally in the browser.

## Technology

The project intentionally uses a lightweight stack:

- HTML
- CSS
- Vanilla JavaScript

There are no build tools, frameworks, or runtime dependencies.

## Project Goals

- make laboratory theory easier to understand visually;
- connect formulas with real experimental data;
- show the difference between statistical quantities and graphical representations;
- help students verify their own calculations;
- keep each tool simple enough to inspect and modify;
- build a reusable collection for future physics labs.

## Status

The repository is under active development. New laboratory tools will be added as the corresponding experiments are completed.

## Contributing

Improvements, corrections, and new educational visualizations are welcome.

When adding a new lab, keep it isolated in its own `lab-X.X.X/` directory and avoid introducing unnecessary dependencies.

## License

No open-source license has been selected yet.
