# DNA Sequence Walk

A small, static GitHub Pages web app that visualizes DNA sequences as a 2D walk.

Each base moves the trace one step on a coordinate grid:

- **A**: +1 on the A–T axis
- **T**: -1 on the A–T axis
- **G**: +1 on the G–C axis
- **C**: -1 on the G–C axis

You can paste a DNA sequence directly or upload a FASTA file. The app can start plotting from the beginning of the sequence or from a selected nucleotide position.

## Features

- Paste raw DNA or FASTA text
- Upload `.fasta`, `.fa`, `.fna`, or `.txt`
- Select FASTA records when a file contains multiple sequences
- Choose start and end positions
- Optionally cap the number of plotted bases for very large sequences
- Interactive zoom and pan
- Reset view
- Export plot as SVG
- Download coordinates as CSV

## Running locally

Open `index.html` in a browser.

For a simple local server:

```bash
python3 -m http.server 8000
```

Then open:

```text
http://localhost:8000
```

## Publishing with GitHub Pages

1. Create a new GitHub repository.
2. Upload all files in this folder.
3. Go to **Settings → Pages**.
4. Set source to **Deploy from a branch**.
5. Choose the `main` branch and `/root`.
6. Save.

## Coordinate definition

Starting point is `(0,0)`.

For each base:

```text
A: x = x + 1
T: x = x - 1
G: y = y + 1
C: y = y - 1
```

Ambiguous bases such as `N`, `R`, `Y`, etc. are skipped by default and do not move the trace.

## Notes

This is a qualitative visualization. It can reveal compositional bias, local sequence structure, repetitive regions, strand bias, and differences between genomes or contigs, but it is not a statistical test by itself.
