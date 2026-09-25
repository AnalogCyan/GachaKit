# Photo Card Capsule

A polaroid-style photo card component with interactive modal functionality.

## Features

- Masonry grid layout for responsive display of photo cards
- Smooth animation when opening/closing the detail modal
- Metadata display for date, location, camera, etc.
- Fullscreen mode with intuitive transitions
- Download functionality for images
- Keyboard-accessible cards and modal with focus trapping and reduced-motion fallbacks

## Usage

Add to any page using the GachaKit drop syntax:

```html
<drop capsule="photo-card"></drop>

<!-- Multiple galleries can coexist; each drop reads its own data attributes -->
<drop
  capsule="photo-card"
  data-count="4"
  data-path="/data/portraits.json"
></drop>
```

### Options

You can customize the behavior with data attributes:

```html
<drop
  capsule="photo-card"
  data-count="6"
  data-path="/data/custom-photos.json"
  data-images-path="/images/portraits/"
></drop>
```

- `data-count`: Number of photos to display (default: 3)
- `data-path`: Path to JSON file with photo data (default: `/data/photos.json`)
- `data-images-path`: Optional base directory for images (defaults to `/images/`)

## Image Structure

The component automatically looks for images in the `/images/` directory. You only need to specify the filename in your JSON data, not the full path:

```json
{
  "imageSrc": "my-photo.jpg" // Will be loaded from /images/my-photo.jpg
}
```

Make sure to:

1. Place your image files in the `src/images/` directory (or mirror the folder referenced by `data-images-path`)
2. Only specify the filename in the JSON data
3. Ensure the build process copies images to the public directory

## JSON Data Structure

The component expects a JSON file with the following structure:

```json
[
  {
    "id": 1,
    "title": "Photo Title",
    "date": "YYYY-MM-DD",
    "location": "Location Name",
    "camera": "Camera Model",
    "imageSrc": "filename.jpg",
    "width": 1400,
    "height": 1400,
    "description": "Detailed description of the photo",
    "tags": ["optional", "tags", "array"]
  }
]
```

`imageSrc` is required; entries without it are skipped. A missing `title` shows as "Untitled". `width` and `height` are optional pixel dimensions of the image: with them the card reserves its space before the lazily loaded image arrives, so the grid does not jump.

## Required Dependencies

- RemixIcon for UI icons
- Nunito font (optional but recommended)
