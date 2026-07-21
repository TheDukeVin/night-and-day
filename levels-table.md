# Starter Pack — Level Table

One row per level. Edit freely, then port changes back into `shared/levels.ts`
and run `npm run verify-levels`.

**Notation**
- **Initial** — `color day/night` (crystals present before any presses).
- **Generators** — `id(side): outputs`, where side is `D`=day / `N`=night. `red+2` means +2 red crystals per press. Comma-separates a combined (multi-color) generator.
- **Solution** — presses per generator that balance the level (`0` = decoy).
- **Difficulty** — my subjective 1–10 rating (gentle ramp; L1≈1, L50≈10).

| #  | Name                 | Concept                              | Initial (day/night)                     | Generators                                   | Solution                  | Difficulty |
|----|----------------------|--------------------------------------|-----------------------------------------|----------------------------------------------|---------------------------|:----------:|
| 1  | First Light          | Counting up                          | red 2/4                                 | d1(D): red+1                                 | d1:2                      | 1.0 |
| 2  | Night's Turn         | Counting up                          | red 5/1                                 | n1(N): red+1                                 | n1:4                      | 1.0 |
| 3  | A Wider Gap          | Counting up                          | red 1/7                                 | d1(D): red+1                                 | d1:7                      | 1.5 |
| 4  | Starlit Climb        | Counting up                          | red 9/3                                 | n1(N): red+1                                 | n1:6                      | 1.5 |
| 5  | Two at a Time        | Skip counting by 2                   | red 5/3                                 | n1(N): red+2                                 | n1:1                      | 2.0 |
| 6  | Three at a Time      | Skip counting by 3                   | red 2/8                                | d1(D): red+3                                 | d1:3                      | 2.5 |
| 7  | Five at a Time       | Skip counting by 5                   | red 10/0                                | n1(N): red+5                                 | n1:2                      | 2.5 |
| 8  | Both Awake           | Both sides can grow                  | red 2/4                                 | d1(D): red+1; n1(N): red+1                   | d1:3, n1:1                | 3.0 |
| 9  | Meet in the Middle   | Both sides can grow                  | red 0/3                                 | d1(D): red+2; n1(N): red+1                   | d1:2, n1:1                | 3.0 |
| 10 | Racing Along         | Growing at different speeds          | red 3/1                                 | d1(D): red+1; n1(N): red+2                   | d1:2, n1:2                | 3.5 |
| 11 | Catching Up          | Growing at different speeds          | red 5/1                                 | d1(D): red+1; n1(N): red+3                   | d1:2, n1:2                | 3.5 |
| 12 | A Steady Chase       | Growing at different speeds          | red 4/3                                 | d1(D): red+2; n1(N): red+3                   | d1:4, n1:3                | 4.0 |
| 13 | Threes and Twos      | Groups of 3 and 2                    | red 3/0                                 | d1(D): red+3; n1(N): red+2                   | d1:1, n1:3                | 4.0 |
| 14 | Twos and Fives       | Groups of 2 and 5                    | red 11/3                                | d1(D): red+2; n1(N): red+5                   | d1:1, n1:2                | 4.5 |
| 15 | Fours and Threes     | Groups of 4 and 3                    | red 1/0                                 | d1(D): red+4; n1(N): red+3                   | d1:2, n1:3                | 4.5 |
| 16 | Fives and Threes     | Groups of 5 and 3                    | red 1/8                                 | d1(D): red+5; n1(N): red+3                   | d1:2, n1:1                | 4.5 |
| 17 | True Blue            | A new color                          | blue 2/0                                | n1(N): blue+1                               | n1:2                      | 3.0 |
| 18 | Blue on Both Sides   | One color, both sides                | blue 1/4                                | d1(D): blue+2; n1(N): blue+1                | d1:2, n1:1                | 3.5 |
| 19 | Two Colors, Two Jobs | Balancing colors separately          | red 1/2, blue 1/3                       | d1(D): red+1; d2(D): blue+1                 | d1:1, d2:2                | 4.0 |
| 20 | Two Colors, Two Sides| Two colors, two gaps                 | red 2/5, blue 4/1                       | d1(D): red+1; n1(N): blue+1                 | d1:3, n1:3                | 4.5 |
| 21 | Crossed Colors       | Helping the other side               | red 3/0, blue 0/4                       | d1(D): blue+1; n1(N): red+1                 | d1:4, n1:3                | 5.0 |
| 22 | Trading Colors       | Helping the other side               | red 6/0, blue 0/8                       | d1(D): blue+2; n1(N): red+2                 | d1:4, n1:3                | 5.0 |
| 23 | Odd One Out          | Two colors, two gaps                 | red 4/0, blue 2/3                       | d1(D): blue+1; n1(N): red+2                 | d1:1, n1:2                | 5.0 |
| 24 | Different Groups     | Two colors, different groups         | red 1/7, blue 5/1                       | d1(D): red+2; n1(N): blue+2                 | d1:3, n1:2                | 5.5 |
| 25 | Pick Your Helper     | Adding groups to make 5              | red 6/1, blue 1/7                       | d1(D): blue+2; n1(N): red+2; n2(N): red+3  | d1:3, n1:1, n2:1          | 6.0 |
| 26 | Two Helpers          | Adding groups together               | red 5/1, blue 0/8                       | d1(D): blue+2; d2(D): blue+3; n1(N): red+1 | d1:1, d2:2, n1:4          | 6.0 |
| 27 | Two in One           | One press, two colors                | red 0/4, blue 0/4                       | d1(D): red+1, blue+1                        | d1:4                      | 4.5 |
| 28 | Two for One          | One press changes two colors         | red 3/1, blue 1/4                       | d1(D): red+1, blue+1; n1(N): red+1         | d1:3, n1:5                | 6.0 |
| 29 | Double Duty          | One press, two colors                | red 0/4, blue 2/5                       | d1(D): red+1, blue+1; n1(N): blue+1        | d1:4, n1:1                | 6.0 |
| 30 | Tangled Pair         | Untangling two colors                | blue 4/0, red 0/1                       | d1(D): red+1; n1(N): red+1, blue+1         | d1:5, n1:4                | 6.5 |
| 31 | Woven Threads        | Untangling groups                    | red 4/0, blue 0/0                       | d1(D): blue+2; n1(N): red+1, blue+2        | d1:4, n1:4                | 6.5 |
| 32 | Double Blues         | One color decides the other          | red 3/0                                 | d1(D): blue+1; n1(N): red+1, blue+2        | d1:6, n1:3                | 7.0 |
| 33 | The Extra Helper     | Not every helper is needed           | red 6/0, blue 0/2                       | d1(D): blue+1; n1(N): red+2; n2(N): red+3  | d1:2, n1:0, n2:2          | 6.5 |
| 34 | Fair Trade           | Working out the order                | red 4/1, blue 1/0                       | d1(D): blue+2; n1(N): red+1, blue+1        | d1:1, n1:3                | 7.0 |
| 35 | Careful Order        | Working out the order                | red 2/1, blue 1/5                       | d1(D): red+1, blue+2; n1(N): red+1         | d1:2, n1:3                | 7.0 |
| 36 | Two Tangles          | Two tangled pairs                    | red 0/2, blue 1/3                       | d1(D): red+1, blue+1; n1(N): red+1, blue+1 | d1:3, n1:1                | 7.5 |
| 37 | Three Threads        | Three colors to juggle               | red 3/0, green 1/0, blue 0/2            | d1(D): blue+1; n1(N): red+1; n2(N): green+1| d1:2, n1:3, n2:1          | 6.0 |
| 38 | Green Grows          | Three colors, one each               | red 4/2, green 1/3, blue 3/1           | d1(D): green+1; n1(N): red+1; n2(N): blue+1| d1:2, n1:2, n2:2          | 6.5 |
| 39 | Three in Balance     | Three colors, bigger groups          | red 5/1, green 0/4, blue 2/6           | d1(D): green+2; d2(D): blue+2; n1(N): red+2| d1:2, d2:2, n1:2          | 7.0 |
| 40 | Trading Places       | Three colors, tangled together       | blue 2/0, red 0/1, green 0/3           | d1(D): red+1, green+1; n1(N): red+1; n2(N): blue+1 | d1:3, n1:2, n2:2  | 7.5 |
| 41 | A Shared Helper      | Three colors with a combined gen     | red 0/5, green 0/2, blue 4/0           | d1(D): red+1, green+1; d2(D): red+1; n1(N): blue+1 | d1:2, d2:3, n1:4  | 7.5 |
| 42 | Three Threads Twist  | Three colors together                | red 6/0, green 0/3, blue 1/5           | d1(D): green+1; d2(D): blue+2; n1(N): red+2| d1:3, d2:2, n1:3          | 8.0 |
| 43 | The Long Way Round   | Big moves, careful counting          | red 5/0, blue 0/2, green 0/1           | d1(D): red+1, blue+2; d2(D): green+1; n1(N): red+2, blue+1 | d1:3, d2:1, n1:4 | 8.5 |
| 44 | A Busy Sky           | Three colors and a combined gen      | red 0/4, blue 0/6, green 2/0           | d1(D): red+1, blue+1; d2(D): blue+1; n1(N): green+1 | d1:4, d2:2, n1:2 | 8.0 |
| 45 | Four Corners         | Four generators, pick wisely         | red 1/5, green 4/0, blue 0/3           | d1(D): red+2; d2(D): blue+1; n1(N): green+1; n2(N): red+1 | d1:2, d2:3, n1:4, n2:0 | 8.5 |
| 46 | Tangled Sky          | Three colors, one combined pair      | red 0/3, green 5/2, blue 0/1           | d1(D): red+1; d2(D): blue+2; n1(N): green+1, blue+1 | d1:3, d2:2, n1:3 | 8.5 |
| 47 | Balancing Act        | Keeping every color in balance       | red 3/0, green 0/4, blue 2/8           | n1(N): red+1; d1(D): green+2; d2(D): blue+3; n2(N): green+2 | n1:3, d1:2, d2:2, n2:0 | 9.0 |
| 48 | The Clever Sky       | A combined helper for two colors     | red 0/4, green 0/6, blue 5/1           | d1(D): red+1, green+1; d2(D): green+1; n1(N): blue+2 | d1:4, d2:2, n1:2 | 9.0 |
| 49 | One Last Practice    | Everything you have learned          | red 0/3, green 4/0, blue 1/2           | d1(D): red+1, blue+1; d2(D): green+2; n1(N): blue+2; n2(N): green+1 | d1:3, d2:0, n1:1, n2:4 | 9.5 |
| 50 | Grand Balance        | Everything together                  | red 1/0, green 1/3                      | d1(D): green+2, blue+1; d2(D): red+1; n1(N): blue+2; n2(N): green+1, red+1 | d1:2, d2:1, n1:1, n2:2 | 10.0 |
