# Gradient Background Capsule

A beautiful flowing gradient background with subtle grain overlay for depth and texture.

## Usage

Add this capsule at the top of your page template:

```html
<drop capsule="gradient-background" data-animated="true"></drop>
```

Without `data-animated="true"` the nodes stay where CSS puts them and no animation runs.

## Features

- Smooth flowing gradient animation that uses your theme's accent color
- Subtle grain overlay for added texture and depth
- Properly positioned with z-index to stay behind all other content
- Automatically spans the full viewport

## Customization

The gradient uses CSS variables from your theme:

- `--accent-hue`: Controls the base hue of the gradient (defaults to 205)

Attributes:

- `data-animated`: Set to `"true"` to randomize node positions and animate them

You can modify the intensity of the grain by adjusting the opacity in the CSS.

## Example

```html
<body>
  <drop capsule="gradient-background" data-animated="true"></drop>
  <drop capsule="header"></drop>
  <!-- Rest of your content -->
</body>
```
