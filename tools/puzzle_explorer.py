"""Explore 2-color balance puzzles.

State is (r, b): the *difference* in the number of crystals between the two
sides of the board for the red and blue colors. The solved/balanced state is
(0, 0). Each generator press adds a fixed (dr, db) to the state.

Given a set of generators, this does a BFS over the integer lattice from (0, 0)
and records the minimum number of presses needed to reach every reachable
state within a bounded window, then plots that as a 2D heat grid.

Usage:
    python tools/puzzle_explorer.py
    python tools/puzzle_explorer.py -g 1,2 -g 2,2 -g -3,0 -g -2,-1
    python tools/puzzle_explorer.py --gen 1,2 --gen 2,2 --bound 20 --save out.png
"""

import argparse
from collections import deque

import matplotlib.pyplot as plt
import numpy as np

# --- Generators -----------------------------------------------------------
# Each generator is a (dr, db) delta applied to the state on one press.
# Day generators add crystals, night generators remove them.
DAY_GENERATORS = {
    "day (+1r, +2b)": (1, 2),
    "day (+2r, +2b)": (2, 2),
}
NIGHT_GENERATORS = {
    "night (-3r)": (-3, 0),
    "night (-2r, -1b)": (-2, -1),
}
GENERATORS = {**DAY_GENERATORS, **NIGHT_GENERATORS}

# How far out from the origin to explore, in each direction.
BOUND = 15


def explore(generators, bound=BOUND):
    """BFS from (0,0). Returns {(r, b): min_presses} within [-bound, bound]^2."""
    deltas = list(generators.values())
    dist = {(0, 0): 0}
    queue = deque([(0, 0)])
    while queue:
        state = queue.popleft()
        r, b = state
        d = dist[state]
        for dr, db in deltas:
            nxt = (r + dr, b + db)
            if abs(nxt[0]) > bound or abs(nxt[1]) > bound:
                continue
            if nxt not in dist:
                dist[nxt] = d + 1
                queue.append(nxt)
    return dist


def plot(dist, generators, bound=BOUND):
    """Render min-press counts as a 2D grid centered on the origin."""
    size = 2 * bound + 1
    grid = np.full((size, size), np.nan)
    for (r, b), d in dist.items():
        # rows = b (blue), cols = r (red); origin at center.
        grid[b + bound, r + bound] = d

    fig, ax = plt.subplots(figsize=(9, 8))
    # Higher blue (b) at the top: invert so +b points up.
    im = ax.imshow(
        grid,
        origin="lower",
        cmap="viridis",
        extent=(-bound - 0.5, bound + 0.5, -bound - 0.5, bound + 0.5),
    )

    # Annotate each reachable cell with its press count.
    for (r, b), d in dist.items():
        ax.text(r, b, str(d), ha="center", va="center",
                color="white", fontsize=6)

    ax.set_xlabel("red diff (r)")
    ax.set_ylabel("blue diff (b)")
    ax.set_title("Minimum presses to reach each state\n"
                 + ", ".join(generators.keys()))
    ax.axhline(0, color="white", lw=0.5, alpha=0.4)
    ax.axvline(0, color="white", lw=0.5, alpha=0.4)
    ax.scatter([0], [0], color="red", marker="*", s=200,
               zorder=5, label="balanced (0,0)")
    ax.legend(loc="upper right")
    ax.set_xticks(range(-bound, bound + 1, 5))
    ax.set_yticks(range(-bound, bound + 1, 5))
    ax.grid(True, alpha=0.15)
    fig.colorbar(im, ax=ax, label="min presses")
    fig.tight_layout()
    return fig


def parse_generator(text):
    """Parse a "dr,db" string into a (dr, db) int tuple."""
    parts = text.split(",")
    if len(parts) != 2:
        raise argparse.ArgumentTypeError(
            f"generator {text!r} must be two ints 'dr,db'")
    try:
        return (int(parts[0]), int(parts[1]))
    except ValueError:
        raise argparse.ArgumentTypeError(
            f"generator {text!r} must be two ints 'dr,db'")


def main():
    parser = argparse.ArgumentParser(description=__doc__,
                                     formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument(
        "-g", "--gen", type=parse_generator, action="append", metavar="dr,db",
        dest="gens",
        help="a generator delta as 'dr,db' (repeatable). "
             "If omitted, the built-in day/night set is used.")
    parser.add_argument("--bound", type=int, default=BOUND,
                        help=f"explore +/- this many in each axis (default {BOUND})")
    parser.add_argument("--save", metavar="PATH",
                        help="save the plot to PATH instead of opening a window")
    args = parser.parse_args()

    if args.gens:
        generators = {f"({dr:+d}r, {db:+d}b)": (dr, db) for dr, db in args.gens}
    else:
        generators = GENERATORS

    dist = explore(generators, args.bound)
    print(f"Generators: {list(generators.keys())}")
    print(f"Reachable states within +/-{args.bound}: {len(dist)}")
    # A few sample lookups.
    for state in [(0, 0), (1, 2), (-3, 0), (5, 4), (-6, -3)]:
        d = dist.get(state)
        print(f"  {state}: {'unreachable' if d is None else f'{d} presses'}")
    fig = plot(dist, generators, args.bound)
    if args.save:
        fig.savefig(args.save, dpi=110)
        print(f"saved {args.save}")
    else:
        plt.show()


if __name__ == "__main__":
    main()
