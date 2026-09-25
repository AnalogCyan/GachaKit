# Button Array Capsule

CSS-only connected-pill button rows with Material-style radius choreography. Hover one button and siblings gently shrink.

## Usage

```html
<drop capsule="button-array"></drop>
<nav class="button-group" aria-label="Actions">
  <a
    class="button secondary button-group__item button-group__item--first"
    href="#"
    >First</a
  >
  <a
    class="button secondary button-group__item button-group__item--middle"
    href="#"
    >Middle</a
  >
  <a
    class="button secondary button-group__item button-group__item--last"
    href="#"
    >Last</a
  >
</nav>
```

## Features

- Radius choreography via `--first`, `--middle`, `--last` modifier classes
- Hover sibling shrink effect via `flex-grow`
- Stacks vertically on small screens
- CSS-only, no JavaScript required
