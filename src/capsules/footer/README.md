# Footer Capsule

Minimal slot-based site footer for GachaKit. Content is provided via the `<drop>` slot.

## Usage

```html
<drop capsule="footer">
  <p>&copy; 2024-2025 Your Project. All rights reserved.</p>
</drop>
```

## Dependencies

- Uses CSS variables from `variables.css`
- CSS selector: `footer[data-capsule="footer"]`

## Features

- Centered, muted footer pinned to bottom of page
- Slot-based, any HTML content can be injected
- Minimal styling: flex column, text center, muted colors
