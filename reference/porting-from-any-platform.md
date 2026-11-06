# Porting an indicator or strategy from any platform

This page is for every source without a route of its own: another chart or
terminal language, a C-like or C# indicator class, an array formula language,
Python, a spreadsheet, or a formula from a book or a description. Two sources
have their own route and come first:

| The original | Route |
|---|---|
| opens with `//@version=5` or `//@version=6` | `import.mjs`, then read every `OS9007` warning against the table below |
| opens with `//@version=4` | convert it to version 5 in its own editor, then `import.mjs`; a script that does not convert is ported by hand with this page |
| opens with `//@version=3` or older, or has no version line but calls `study(`, `security(` or an unprefixed `sma(` | its editor converts version 3 to version 4 only, so convert step by step where it can and port by hand where it cannot |
| a JavaScript descriptor handed to `registerIndicator` with a `calc(bars, settings)` | `reference/porting-from-javascript.md` |
| anything else | this page |

`reference/porting-from-javascript.md` is worth reading whatever the source:
its sections on absent values, `fn` bodies, markers, tables, inputs and time
zones are about OpenScript, not about JavaScript, and every port meets them.

**The original is the specification.** Port its arithmetic, not the textbook
indicator its name suggests. Two platforms that both call something "RSI" or
"EMA" routinely disagree for hundreds of bars, and a port that matches the
textbook and not the original is wrong.

**How to read the code blocks.** As on the JavaScript page: every `openscript`
block compiles with no diagnostic once `version 1` and a `study(...)` line are
put above it, and a block whose first line begins `// Wrong:` is the spelling
to avoid, with what the compiler reports. `check-porting.mjs` compiles every
block here and measures every row of the definitions table against the
compiler, so a claim on this page that stops being true fails the build.

---

## How a port goes

1. **Get the original's own numbers before writing a line.** Most platforms
   export a chart's bars with its indicator values to CSV; a Python original
   can simply be run; a spreadsheet saves as CSV; a book's worked example can
   be typed in. Without them a port can be compiled but not checked, and the
   trader must be told that in those words.
2. **Read the whole original and list** its inputs (name, default, range), its
   plots and levels (title, colour, kind), every value it carries from one bar
   to the next, and every built-in it calls.
3. **Decide how it runs** (the next section) and translate its indexing.
4. **Look every built-in up by what it computes, not by its name**, in the
   definitions table below.
5. **Compile with `validate.mjs`, then compare with `compare.mjs`** against the
   original's numbers. Repeat until it reports SAME, or until every remaining
   difference is understood and written down for the trader.

---

## Three ways an original runs

OpenScript runs the whole script once per bar, oldest bar first, and `x[k]` is
`x` as it stood `k` bars ago. Every source is one of three shapes, and each has
its own way to get the direction of history wrong.

### Whole-array formulas

Array formula languages (`Ref(C, -1)`, `IIf`, `Param`, `Plot`), pandas and
numpy code that works on whole columns, and spreadsheets. Each line computes a
whole column at once. It becomes the same line at the top level, run once per
bar.

- **Back** is `Ref(x, -k)`, `x.shift(k)`, or the cell `k` rows above: `x[k]`.
- **Forward** is `Ref(x, +k)`, `x.shift(-k)`, or a row below. It reads a bar
  that has not happened, and a study cannot. See "An original that reads the
  future" below.
- A **loop inside an array formula** (`for (i = 1; i < BarCount; i++)`) indexes
  from the oldest bar: `x[i - k]` is `x[k]`, and the loop body becomes the top
  level, as in the JavaScript page.

### A series per bar

Languages whose script body runs once per bar and where `Close[1]` is the
previous bar: numbered-plot languages (`Inputs:`, `Vars:`, `Plot1(...)`),
def and plot languages with semicolons (`input length = 14;`, `def x = ...;`,
`plot P = ...;`), and C# classes with `OnBarUpdate()` and `Close[0]`. This is
the closest shape to OpenScript, and `x[k]` reads the same way.

- **A variable that keeps its value between bars is a `var`.** In the
  numbered-plot languages every variable keeps its last value unless the bar
  reassigns it; an OpenScript name without `var` is recomputed every bar. An
  original that assigns a variable only inside an `if` needs `var`.
- **A negative index reads the future** in the def and plot languages: `x[-1]`
  is the next bar.
- **A counter of bars may start at 1, or after a warm-up allowance.** Find out
  which, and use `bar.index` (0 on the first bar) or `bar.count` (1 on the
  first bar) to match. A platform that holds back the first bars it was told to
  (a maximum-bars-back setting) shows nothing there; `compare.mjs --skip n`
  leaves them out of the judgement.

### A loop over buffers

C-like terminal languages (`#property`, `OnCalculate(...)` or `start()`,
`SetIndexBuffer`, `iMA(...)`), C# classes with `Calculate(int index)` and
`Result[index]`, and JavaScript. The index is a position, not a distance back,
and **which end is 0 decides everything**:

| Index 0 is | Previous bar | Typical tell |
|---|---|---|
| the oldest bar | `buf[i - 1]` | ordinary arrays; `Calculate(int index)`; a loop `for (i = 1; i < total; i++)` |
| the newest bar | `buf[i + 1]` | buffers set as series (`ArraySetAsSeries(buf, true)`), `Close[i]` in the older C-like language; a loop `for (i = limit; i >= 0; i--)` |

Either way the previous bar is `x[1]` in the port. Then:

- **Drop the bookkeeping that avoids recomputing old bars** (`prev_calculated`,
  `IndicatorCounted()`, a `limit` derived from them). Every OpenScript
  statement runs once per bar already.
- **An empty-buffer marker is `none`.** `EMPTY_VALUE` is the largest double in
  the newer C-like language and 2147483647 in the older one, and a buffer can
  be told to treat `0` as empty instead. `compare.mjs` reads both markers as no
  value; an export that writes `0` for an empty bar has to be cleaned first.
- **Two different shifts.** An average's own shift (`ma_shift`) moves the line:
  a shift of 3 draws three bars to the right, `plot(x, "MA", offset = 3)`. The
  last argument of the older language's indicator calls, and the shift of
  `iClose(..., shift)`, is which bar to read: a shift of 1 is `x[1]`.

---

## The shapes that recur

| In the original | In the port |
|---|---|
| `Ref(x, -1)`, `x[1]` in a series language, `buf[i - 1]` oldest first, `buf[i + 1]` newest first, `x.shift(1)`, the row above | `x[1]` |
| `IIf(c, a, b)`, `np.where(c, a, b)`, `IF(c, a, b)`, `c ? a : b` | `c ? a : b` |
| `Null`, `Double.NaN`, `NaN`, `None`, `EMPTY_VALUE`, an empty cell | `none` |
| `IsNull(x)`, `IsNaN(x)`, `pd.isna(x)` | `isNone(x)` |
| `Nz(x)`, `x.fillna(0)` | `orElse(x, 0)`, only where the original really reads zero |
| `x.ffill()`, a variable that keeps its last good value | a `var` updated inside `if not isNone(x)` (below) |
| `Cum(x)`, `x.cumsum()` | `cum(x)` |
| `Sum(x, n)`, `Summation(x, n)`, `x.rolling(n).sum()` | `sum(x, n)` |
| `HHV(x, n)`, `Highest(x, n)`, `MAX(x, n)`, `x.rolling(n).max()` | `highest(x, n)`, which includes this bar |
| `Cross(a, b)`, `a crosses above b`, `CrossAbove(a, b, 1)` | `crossUp(a, b)`: at or below on the previous bar, above now |
| `BarsSince(c)` | `barsSince(c)`: 0 on the bar itself, absent before the first |
| `ValueWhen(c, x, 1)`, the most recent occurrence counted from 1 | `valueWhen(c, x, 0)`: occurrences are counted from 0 |
| `(H + L + C) / 3`, a typical price constant | `hlc3` |
| `(H + L) / 2`, a median price constant | `hl2` |
| `(H + L + 2 * C) / 4`, a weighted close constant | `hlcc4` |
| `colorRed`, `clrRed`, `Color.Red`, `color.red` | `red`, or `#ff0000`: colours are bare names |
| `m, s, h = MACD(...)`, `[m, s, h] = macd(...)` | `macd(close, 12, 26, 9)[0]`, `[1]`, `[2]`: read each element by index |

The forward fill, which holds the last value present:

```openscript
var lastClose = none
if not isNone(close)
    lastClose = close
plot(lastClose, "Last close")
```

There is no destructuring assignment:

```openscript
// Wrong: OS1018 and OS2001: a multi-value result is not unpacked into names
[m, s, h] = macd(close, 12, 26, 9)
plot(s, "Signal")
```

```openscript
macdLine = macd(close, 12, 26, 9)[0]
signalLine = macd(close, 12, 26, 9)[1]
plot(macdLine, "MACD")
plot(signalLine, "Signal")
```

And colours are bare names, not members of a namespace:

```openscript
// Wrong: OS1019 and OS2009: color is a reserved word, and red is not a member of it
plot(close, "Close", color.red)
```

```openscript
plot(close, "Close", red)
```

---

## Same name, different numbers

This is where ports from other platforms go wrong, and none of it is refused by
the compiler. The first column is the OpenScript expression; the second is what
it computes, **measured**, not recalled; the third is the first bar it answers
on, for the lengths shown. `check-porting.mjs` runs every row on test bars
against an independent implementation and holds the page to it.

The helpers the table calls, for the variants OpenScript has no built-in for.
Copy the ones a port needs; each keeps its own state per call site.

```openscript
// Helpers for the table below.
fn emaFromFirst(src, len) =>
    var e = none
    a = 2 / (len + 1)
    e = isNone(e) ? src : src * a + e * (1 - a)
    e

fn emaAdjusted(src, len) =>
    var num = 0.0
    var den = 0.0
    w = 1 - 2 / (len + 1)
    num = src + w * num
    den = 1 + w * den
    num / den

fn rmaFromFirst(src, len) =>
    var r = none
    r = isNone(r) ? src : (r * (len - 1) + src) / len
    r

fn partialMean(src, len) =>
    running = cum(src)
    full = sma(src, len)
    bar.index < len - 1 ? running / bar.count : full

fn rsiSimple(src, len) =>
    upAvg = sma(max(change(src), 0), len)
    downAvg = sma(max(-change(src), 0), len)
    downAvg == 0 ? 100 : 100 - 100 / (1 + upAvg / downAvg)

fn meanDeviation(src, len) =>
    centre = sma(src, len)
    spread = 0.0
    for k = 0 to len - 1
        spread += abs(src[k] - centre)
    spread / len

fn cciOf(src, len) => (src - sma(src, len)) / (0.015 * meanDeviation(src, len))

fn rankOfPrevious(src, len) =>
    hits = 0
    for k = 1 to len
        if src[k] <= src
            hits += 1
    bar.index >= len and not isNone(src) ? 100 * hits / len : none

plot(emaFromFirst(close, 14), "EMA from the first value")
```

| OpenScript | Computes exactly | First value |
|---|---|---|
| `sma(close, 20)` | the mean of the last 20 values | bar 19 |
| `partialMean(close, 20)` | the mean of the bars so far until there are 20, then `sma`: an average that answers from the first bar with a short window, as `min_periods=1` does in pandas | bar 0 |
| `ema(close, 14)` | weight `2 / (14 + 1)`, seeded on bar 13 with the simple mean of the first 14 values | bar 13 |
| `emaFromFirst(close, 14)` | the same weight, seeded with the first value; an exponential average that answers from bar 0. pandas `ewm(span=14, adjust=False)` is this | bar 0 |
| `emaAdjusted(close, 14)` | the weighted mean of every value so far with weights `(1 - a)^k`, which is pandas `ewm(span=14)` with its default `adjust=True`; it converges on the two above | bar 0 |
| `rma(close, 14)` | weight `1 / 14`, seeded like `ema`: the smoothing called Wilder's, smoothed, or SMMA | bar 13 |
| `rmaFromFirst(close, 14)` | the same weight, seeded with the first value; pandas `ewm(alpha=1/14, adjust=False)` and `ewm(com=13, adjust=False)` | bar 0 |
| `wma(close, 14)` | linear weights, 14 on the newest down to 1 | bar 13 |
| `stdev(close, 20)` | **population** deviation, dividing by 20; numpy's `std` default and a spreadsheet's `STDEV.P` | bar 19 |
| `stdev(close, 20, true)` | **sample** deviation, dividing by 19; pandas `rolling(20).std()` default and a spreadsheet's `STDEV.S` | bar 19 |
| `trueRange()` | the bar's range including a gap from the previous close, and `high - low` on the first bar | bar 0 |
| `atr(14)` | `rma(trueRange(), 14)`, so seeded with the simple mean of the first 14 ranges, the first bar's included | bar 13 |
| `sma(trueRange(), 14)` | an average true range that is a simple mean throughout, as some platforms compute it | bar 13 |
| `rma(bar.index > 0 ? trueRange() : none, 14)` | Wilder's average of ranges that start on the second bar, for an original whose true range is undefined on the first | bar 14 |
| `rsi(close, 14)` | Wilder's: `rma` of the gains and of the losses, 100 when there were no losses | bar 14 |
| `rsiSimple(close, 14)` | the same ratio with simple means of gains and losses, a variant some platforms ship | bar 14 |
| `highest(high, 20)` | the largest of the last 20 values, **this bar included** | bar 19 |
| `highest(high[1], 20)` | the largest of the 20 bars before this one, for a breakout above the previous highs | bar 20 |
| `roc(close, 10)` | the change over 10 bars as a **percentage**; pandas `pct_change(10)` is the same change as a fraction | bar 10 |
| `mom(close, 10)` | the change over 10 bars as a **difference** | bar 10 |
| `100 * close / close[10]` | momentum as a **ratio** times 100, centred on 100, as some platforms define it | bar 10 |
| `cci(20)` | on `hlc3`, against its 20 bar mean, in units of 0.015 times the mean deviation; it takes no source | bar 19 |
| `cciOf(close, 20)` | the same on any source | bar 19 |
| `percentRank(close, 20)` | the share of the last 20 values, **this bar included**, at or below this bar's | bar 19 |
| `rankOfPrevious(close, 20)` | the share of the 20 bars before this one at or below this bar's, as the version-annotated chart language defines it | bar 20 |
| `stoch(14, 3, 3)[0]` | `%K`: the close's place in the 14 bar range, then a 3 bar simple mean; `stoch(14, 1, 3)` is the fast form | bar 15 |
| `stoch(14, 3, 3)[1]` | `%D`: a 3 bar simple mean of that `%K` | bar 17 |
| `bollinger(close, 20, 2)[1]` | the upper band: `sma` plus 2 **population** deviations | bar 19 |
| `sma(close, 20) + 2 * stdev(close, 20, true)` | the upper band with sample deviations, as a pandas original usually computes it | bar 19 |
| `macd(close, 12, 26, 9)[0]` | `ema(close, 12) - ema(close, 26)`, both seeded as `ema` is | bar 25 |
| `macd(close, 12, 26, 9)[1]` | the signal: an `ema` of that line, seeded with the simple mean of its first 9 values | bar 33 |
| `sma(macd(close, 12, 26, 9)[0], 9)` | a signal line that is a simple mean, as some platforms draw it | bar 33 |
| `williamsR(14)` | the close's place in the 14 bar range, from 0 at the high to -100 at the low | bar 13 |
| `hma(close, 15)` | `wma(2 * wma(src, 7) - wma(src, 15), 4)`: the half length rounds down, the root rounds to nearest | bar 17 |
| `obv()` | 0 on the first bar, then volume added on an up close, taken away on a down close, unchanged on an equal one | bar 0 |
| `mfi(14)` | `rsi`'s ratio over 14 bars of typical price times volume, a bar whose typical price did not move counting on neither side | bar 14 |

Two more definitions that a port meets, measured the same way:

- **`crossUp(a, b)` has no value until both series and their previous values
  exist**, and a ternary reads that as false. Some platforms require the
  previous bar to be strictly below: `a > b and a[1] < b[1]`.
- **`valueWhen(cond, src, 0)` is the most recent bar the condition held, this
  bar included**, and `barsSince(cond)` is 0 on that bar.

### Telling the seeds apart

The seed decides the first few hundred bars and nothing after, so a port with
the wrong one looks right on a chart and fails a comparison at the start. When
`compare.mjs` says the early bars differ and then converge, try the seeds in
this order: the original's documentation or source if either says, then
`emaFromFirst` against `ema` (or `rmaFromFirst` against `rma`), then
`emaAdjusted` for anything that came from pandas without `adjust=False`.

Averages built from averages inherit the choice: a `dema`, `tema`, `macd` or
`trix` on an original that seeds with the first value is built from
`emaFromFirst`, not from the built-in. `dema` is
`2 * e1 - emaFromFirst(e1, len)` with `e1 = emaFromFirst(src, len)`.

---

## An original that reads the future

`Ref(x, +k)`, `x[-k]` in a def and plot language, `x.shift(-k)`, a centred
average, a zigzag, and fractal or pivot plots that appear on the pivot bar
itself all use bars that had not happened yet when the bar was drawn. On a live
chart that original repaints: what it showed yesterday is not what it shows
today.

A study cannot read the future, and that is not a gap to work around. Two
honest ports:

- **Compute on the bar where the value becomes known, and draw it back** with a
  negative literal offset (the pivot pattern in the JavaScript page):

```openscript
fractal = high[2] > high[4] and high[2] > high[3] and high[2] > high[1] and high[2] > high ? high[2] : none
plot(fractal, "Up Fractal", red, style = "lineWithMarkers", offset = -2)
```

- **Or say the original cannot be ported as it draws**, and port what it would
  have known at the time. Either way tell the trader the port does not repaint
  and the original does, so the two will disagree on recent bars by design.

A strategy that trades on a value from the future reports trades nobody could
have taken. Never port one as it stands.

---

## Higher timeframes and other instruments

`req.timeframe("1D", close)` reads the **last finished** daily bar, which is
the `"confirmed"` mode. Originals differ on this more than on anything else:

- An original that shows today's value changing during the day is reading the
  **forming** higher bar. That is `req.timeframe("1D", close, "developing")`.
- An original that shows the day's final value from its first bar is reading
  the future; `"lookahead"` reproduces it and is warning `OS8005` (see
  `reference/pitfalls.md`). Never trade from it.
- A read that names the previous finished bar outright (an offset of 1 into a
  daily series) is the confirmed read.

`req.symbol` reads another instrument on the same terms.

---

## Porting a strategy

The rules on `reference/pitfalls.md` and `reference/strategies.md` apply; these
are the ones that bite a port from another platform.

- **When an order fills.** By default an order from a bar fills at the **next
  bar's open** (`fillOn = "nextOpen"`), which is what "buy next bar at market"
  means elsewhere, and what a one-bar trade delay with the buy price set to the
  open means in an array formula language. An original that fills on the bar
  it decides, at its close, is `fillOn = "close"` in the declaration.
- **"Sell" on another platform often means leave a long, not go short.** In
  the numbered-plot languages and the array formula languages, `Sell` exits a
  long and a separate word (`Sell Short`, `Short`) opens a short. Here an exit
  is `close(...)`, and `sell` opens or adds to a short. Port the meaning, not
  the word.
- **Signals become guarded orders.** An array original sets `Buy` and `Sell`
  on every bar their condition holds and removes the repeats (`ExRem`); a
  per-bar original checks its position. Here, guard each order with the
  position, as `examples/long-only.oscript` does:

```openscript
version 1
lots = input(1, "Quantity", min = 1)
strategy("Ported crossover", overlay = true, qty = lots, fillOn = "close")
fast = ema(close, 10)
slow = ema(close, 30)
plot(fast, "Fast", aqua)
plot(slow, "Slow", orange)
if crossUp(fast, slow) and pos.isFlat
    buy(qty = lots, tag = "Long")
if crossDown(fast, slow) and pos.isLong
    close(tag = "Long")
```

- **What a strategy here cannot do yet** (read back its own fills, size by
  risk, run legs) is listed in `reference/strategies.md`. An original that
  depends on one of those has no exact port in this version; say so.

---

## Notes by source

### Array formula languages

- Each statement is a whole column; port it as one top-level line.
- `Param`, `ParamToggle` and `ParamList` are inputs: `input(14, "Length", min = 1, max = 100, step = 1)`,
  `input(true, "Show")`, `input("SMA", "Type", options = ["SMA", "EMA"])`.
- `Plot(x, "Name", colorRed, styleHistogram)` is `plot(x, "Name", red, style = "histogram")`;
  `PlotShapes` is `signal(...)`; a horizontal grid or `Plot(70, ...)` is `level(70, "Overbought")`.
- `Buy`, `Sell`, `Short` and `Cover` are four signals, of which `Sell` and
  `Cover` are exits (see the strategy section). The trade delays and the buy
  and sell price arrays decide the fill: a delay of one bar at the open is
  `fillOn = "nextOpen"`, no delay at the close is `fillOn = "close"`.
- `TimeFrameSet` and `TimeFrameExpand` are a higher timeframe read; which bar
  the expanded value shows is the question in the higher timeframe section.

### Numbered-plot bar languages

- `Inputs: Length(14);` is `length = input(14, "Length")`; `Vars: MyAvg(0);`
  is `var myAvg = 0.0` when it is reassigned conditionally, and a plain name
  when every bar assigns it.
- `Plot1(x, "Name")` is `plot(x, "Name")`; `Plot2` and onwards are further plots.
- `Average` is `sma`, `Highest` and `Lowest` are `highest` and `lowest`, and
  `Summation` is `sum`. Look up the exponential and deviation functions' seed
  and divisor before choosing a row of the definitions table.
- `Buy next bar at market` fills at the next open; `this bar on close` is
  `fillOn = "close"`. `Sell` and `Buy to Cover` are exits.

### Def and plot languages

- `input length = 14;` is an input, `def x = ...;` a series, `plot P = ...;` a
  plot titled `P` (its `SetDefaultColor` is the plot's colour).
- `x[1]` is the previous bar and **`x[-1]` the next one**.
- A recursion seeded on the first bar, `def s = CompoundValue(1, s[1] + x, 0);`,
  is a `var`:

```openscript
var total = 0.0
total = bar.index == 0 ? 0 : total + close
plot(total, "Running total")
```

- `fold i = 0 to n with acc = 0 do acc + GetValue(x, i);` is
  `for i = 0 to n - 1` over `x[i]`: a fold never reaches its end value.
- `AddCloud(a, b)` is `fill` between two plot handles; `AddLabel` and
  `AddChartBubble` are a `table` cell and a `draw.label`.
- `close(period = AggregationPeriod.DAY)` is a higher timeframe read.

### C-like terminal languages

- Settle the direction of the buffers first (the table in "A loop over buffers").
- `input int InpPeriod = 14;` (or `extern int`) is an input; `#property
  indicator_level1 70` is `level(70)`; each `SetIndexBuffer` with a label is a
  plot.
- A moving average call names its method: simple is `sma`, exponential is
  `ema` or `emaFromFirst` (check the seed), smoothed is `rma`, linear weighted
  is `wma`. Its price constant picks the source: close, open, high, low, median
  `hl2`, typical `hlc3`, weighted `hlcc4`. Its `ma_shift` is a plot offset; its last argument, in the older language, is
  the bar read.
- Volume in these terminals is often the **tick count**, not traded quantity.
  OpenAlgo's `volume` is traded quantity, so where the export's volume is a
  tick count a volume-weighted port will not match it. Check which the export
  holds, and say so rather than chase it.
- A read of a higher timeframe at a fixed index counts back from the
  **newest** bar, not from the bar being computed, so it shows one value on
  every historical bar; on the newest bar, index 1 is the previous finished
  higher bar (confirmed) and index 0 the forming one (`"developing"`). An
  original that finds each bar's own higher bar by its time is the read to
  port.

### C# indicator classes

- `OnBarUpdate()` with `Close[0]` and `Close[1]` is a series per bar: `close`
  and `close[1]`. `if (CurrentBar < Period) return;` leaves the first bars
  empty, which is the port's warmup.
- `Calculate(int index)` with `Bars.ClosePrices[index]` is a loop with index 0
  the oldest: `[index - 1]` is `close[1]`. `.Last(1)` counts back from the end
  of the series, so it is `close[1]` only on the newest bar; on history it does
  not move.
- `Value[0] = x` or `Values[n][0] = x` writes plot `n`; `Result[index] = x`
  writes the output series. Each is a `plot`.
- An original set to calculate on every tick reads the forming bar; compare
  on closed bars only.

### Python

- **Run the original.** It is the one source whose numbers can be produced
  here: `uv run --with pandas --with numpy python original.py`, writing the bars
  and the result columns with `df.to_csv("values.csv", index=False)`. Add any
  other package it imports with another `--with`.
- `rolling(n)` answers nothing until it has `n` values; with `min_periods=1`
  it answers from the first bar with a short window (`partialMean`).
- `rolling(n).std()` is the **sample** deviation; `np.std` is the population.
- `ewm(span=n)` is `emaAdjusted`; with `adjust=False` it is `emaFromFirst`;
  `ewm(alpha=1/n, adjust=False)` and `ewm(com=n-1, adjust=False)` are
  `rmaFromFirst`.
- `shift(k)` is `x[k]`; `shift(-k)` reads the future.
- `diff()` is `change(x)`, `pct_change(k)` is `roc(x, k) / 100`, `clip(lower=0)`
  is `max(x, 0)`, `cumsum()` is `cum(x)`.
- A wrapper library around a compiled indicator core has its own seeds; run it
  and compare rather than assume it matches pandas.

### Spreadsheets

- A row is a bar and the sheet runs oldest first: a reference to the row above
  is `x[1]`, and a relative range ending on this row, such as `AVERAGE(B2:B21)`
  filled down, is `sma(x, 20)`.
- The first rows' formulas are the seed: a first row that copies the price and
  later rows that blend is `emaFromFirst`; a first average over a block of rows
  is `ema`.
- An absolute reference to a settings cell (`$F$1`) is an input.
- `STDEV` and `STDEV.S` divide by `n - 1`, `STDEV.P` by `n`.

### A formula from a book, a paper or a description

- A written definition rarely says how it starts or which divisor it uses.
  Choose the classic form, write the choice in a comment at the line it
  decides, and say it in the description the trader reads.
- If the source prints a worked example, type its table into a CSV and compare
  against it: a published table is the only specification that settles a seed.

---

## Checking parity: `compare.mjs`

```bash
node .claude/skills/openscript/compare.mjs <port.oscript> <values.csv>
node .claude/skills/openscript/compare.mjs port.oscript values.csv --zone Asia/Kolkata --set Length=9 --map "RSI=rsi_9"
```

The file is the original's bars and its printed values: a time column, open,
high, low, close, optional volume, and one column per plotted value. Header
names pair with the port's plot titles, ignoring case and punctuation, and
`--map "Title=column"` pairs the rest. A setting is given by its input's name
or its title (`--set`, or `--settings file.json`); an unknown one is refused,
so a comparison never silently runs the defaults. The header comment of
`compare.mjs` lists every time format and absent marker it reads.

It reports, per plot, how many bars agree, the first and the largest
difference, and where each side has a value the other lacks. An exported value
is rounded to the digits it was written with, and each cell allows half a unit
in its last digit. When the differences have a recognisable shape it says
which, and each of these was produced by a real mistake while the tool was
built:

| It says | The usual cause |
|---|---|
| the early bars differ and then converge | a different seed: see "Telling the seeds apart" |
| the port matches the original k bars later or earlier | an index read the wrong way round, a shift or offset, or a platform that stamps a bar with its closing time |
| a steady `sqrt((n - 1) / n)` for some `n` | population against sample deviation |
| a steady 100 times, or 0.01 times | a percentage against a fraction |
| a steady offset | a different centre line, or a constant the original adds |
| the original has a value and the port none, at the start | warmup: decide whether the original's early values mean anything, and match them only if they do |

It exits 0 on SAME and 1 otherwise. It does not compare markers, drawings,
tables, colours or a strategy's trades: check those against the original's
chart and its trade list by hand.

Bar times are the bar's **opening** time. Only a script that reads the time or
a session cares, and for those a file from a platform that stamps the close is
one bar out: shift the time column before comparing. Give the zone the file is
written in with `--zone`, as an IANA name.

A SAME is parity on those bars and those settings. Before calling the port
done, run the settings that matter (each menu option, each length at its
minimum and its maximum, values that make the study fire), bars with gaps in
them, and a different time zone if the original reads one, exactly as the last
section of the JavaScript page lists.

---

## When it cannot match

Say which, in the description of the script and in the reply to the trader,
rather than approximating in silence:

- the original reads the future (above);
- it calculates on every tick inside a bar and its export holds intrabar values;
- it reads data the host does not supply here: an order book, tick counts as
  volume, a broker's own instrument fields;
- it calls an external library or reads back a drawing's price;
- it needs a name that is **planned and not implemented** (`OS2020`, marked in
  `reference/library.md`): `kama`, `zigzag`, `vidya`, `zlema`, `fisher` and
  others. Write the original's own recursion instead; their definitions differ
  between platforms anyway, so the original's is the one to copy.
