# MIPT Study Tools

A growing collection of lightweight interactive study materials for MIPT courses.

The repository still uses its original GitHub repository name for compatibility, but the site itself is now organized as a broader study project rather than a physics-labs-only collection.

## Current sections

### Physics

Interactive material for physics courses and laboratory work.

Currently available:

- **Lab 1.1.4 — Statistics of cosmic-ray background**
  - experimental data parser;
  - grouping measurements by time interval;
  - mean, variance, standard deviation and uncertainty of the mean;
  - counting-rate calculation;
  - Poisson and Gaussian comparison;
  - convergence and log-log uncertainty plots;
  - comparison of multiple time intervals;
  - educational distribution simulator.

### Bookshelf

A local-first visual interface for public Yandex Disk libraries.

The bookshelf does **not** contain or host the books themselves. A user provides a public Yandex Disk folder URL in the browser. That URL is saved locally using `localStorage` and is never stored in this repository.

The bookshelf:

- scans the public folder through the public Yandex Disk API;
- finds PDF, DJVU and EPUB files;
- groups recognized books by subject;
- enriches known titles using static metadata from this repository;
- provides shelf and list views;
- supports local search;
- opens a selected file through the Yandex Disk public viewer.

## Structure

```text
.
├── index.html
├── assets/
│   └── site.css
├── bookshelf/
│   ├── index.html
│   ├── bookshelf.css
│   ├── bookshelf.js
│   └── metadata.json
├── physics/
│   ├── index.html
│   └── labs/
│       ├── index.html
│       └── 1.1.4/
│           ├── index.html
│           ├── styles.css
│           ├── app.js
│           └── sample_data.txt
└── lab-1.1.4/
    └── index.html
```

`lab-1.1.4/` is a compatibility redirect for the previous page location.

## Design principles

- Fully static: HTML, CSS and vanilla JavaScript only.
- No backend, database, API secrets or build step.
- Educational tools should explain the underlying idea rather than automatically generate finished coursework.
- Subject areas remain independent and lightweight while sharing common navigation and styling.
- External books and source material are linked or read from user-provided public sources rather than committed as large binary files.

## Planned areas

The structure is intended to expand with interactive materials for calculus, linear algebra, analytic geometry, general physics and additional laboratory work.

## License

No open-source license has been selected yet.
