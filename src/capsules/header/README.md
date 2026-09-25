# Header Capsule

Responsive navigation pill with embedded theme toggle and mobile hamburger menu.

## Features

- Glassmorphic nav pill with sliding active indicator
- Embedded theme toggle (light/dark/auto)
- Mobile hamburger with dropdown menu and Escape-to-close
- Configurable via `data-theme-key` attribute

## Usage

```html
<drop capsule="header" data-theme-key="your_theme_key">
  <li class="nav-pill__item">
    <a href="/" class="nav-pill__link" data-nav="home">
      <i class="ri-home-5-line" aria-hidden="true"></i>
      <span class="nav-pill__text">Home</span>
    </a>
  </li>
</drop>
```

## Technical Notes

- The active link is the one whose `data-nav` matches `data-nav-page` on an enclosing element, usually `<body>` or `page-header`. It gets `is-active` and `aria-current="page"`
- Sliding pill indicator tracks nav items with `data-nav` attributes
- Theme toggle reads `data-theme-key` for localStorage key (defaults to `gachakit_theme`)

## Custom theme key

`theme-init.js` applies the stored theme before first paint and reads its key from its own `<script>` tag. When you set `data-theme-key` on the header, set the same value on that tag, or the page flashes the theme stored under the default key:

```html
<script src="/scripts/theme-init.js" data-theme-key="your_theme_key"></script>
```

## One per page

The nav list carries a fixed `id="nav-pill-menu"`, which the toggle points at with `aria-controls`. Two headers on one page would duplicate that id and break the association, so drop this capsule once per page. `page-header` wraps it for you.
