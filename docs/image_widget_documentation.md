# ATLAS Image Widget Documentation

The ATLAS Image Widget is a high-performance, paged sliding grid system designed to display visual feeds from the AI or external API calls. Features include a 3x2 responsive grid, smooth animations, and a full-screen "Lightroom" lightbox.

## 1. AI Message Triggers (Text-Based)
The AI model can trigger the widget automatically by including special tags in its text response.

### Single Image
```text
[IMAGE: https://example.com/image.jpg]
```

### Multiple Images (JSON Array)
```text
[IMAGES: [{"url": "https://img1.jpg", "name": "View 1"}, {"url": "https://img2.jpg", "name": "View 2"}]]
```

### Complex Object (JSON)
```text
[IMAGES: {"images": [{"url": "...", "name": "..."}], "title": "Optional Title"}]
```

## 2. JavaScript API (Internal)
You can control the widget directly from any frontend script.

### Show Images
```javascript
// Global function
showImage("https://example.com/image.jpg");

// Using the Wrapper
window.imageWidget.show([
  { url: "https://img1.jpg", name: "Data 1" },
  { url: "https://img2.jpg", name: "Data 2" }
]);
```

### Hide Widget
```javascript
hideImage();
// OR
window.imageWidget.hide();
```

## 3. Electron API Integration (External)
The widget listens to the `onApiReceived` bridge. This allows your backend (Python, Node, or another process) to push visual data to the ATLAS frontend.

### Endpoint: `/show-image`
Triggers the paged image widget. The `params` field accepts multiple formats:

#### Use Case 1: Simple URL (String)
Best for a single, quick-look image.
**JSON Payload:**
```json
{
  "url": "/show-image",
  "params": "https://example.com/single-view.jpg"
}
```

#### Use Case 2: Named Image (Object)
Best for single images that need a specific label.
**JSON Payload:**
```json
{
  "url": "/show-image",
  "params": {
    "url": "https://example.com/data.jpg",
    "name": "SENSING_DATA_01"
  }
}
```

#### Use Case 3: Multiple Images (Array)
Best for collections or galleries. The widget will auto-page these into 3x2 grids.
**JSON Payload:**
```json
{
  "url": "/show-image",
  "params": [
    {"url": "https://img1.jpg", "name": "ANGLE_ALPHA"},
    {"url": "https://img2.jpg", "name": "ANGLE_BETA"},
    {"url": "https://img3.jpg", "name": "ANGLE_GAMMA"}
  ]
}
```

#### Use Case 4: Complex Object (Images Key)
Use this if your data structure is already wrapped in an object.
**JSON Payload:**
```json
{
  "url": "/show-image",
  "params": {
    "images": [
      {"url": "https://img1.jpg", "name": "DEPTH_MAP"},
      {"url": "https://img2.jpg", "name": "THERMAL_VIEW"}
    ]
  }
}
```

### Endpoint: `/hide-image`
Immediately closes the widget and clears the visual feed.
**JSON Payload:**
```json
{
  "url": "/hide-image"
}
```

## 4. Example Backend Implementation (Python)
If you are using the `gemini-client` or a similar bridge:
```python
# To show a gallery
data = {
    "url": "/show-image",
    "params": [
        {"url": "https://...", "name": "LOG_01"},
        {"url": "https://...", "name": "LOG_02"}
    ]
}
send_to_frontend(data)
```


## 5. UI Features & Controls
- **Paged Navigation**: Auto-chunks images into pages of 6. Use the gold floating arrows or pagination dots to navigate.
- **Lightbox (Full-Screen)**: Click any image card to enter full-screen mode.
- **Keyboard Shortcuts**: 
  - `Escape**: Close Lightbox (if open) or Hide the entire Widget.
- **Responsive Recovery**: The widget recalculates page widths on window resize to maintain visual center.

## 6. File Structure
- [index.html](file:///d:/Code/ATLAS/frontend/index.html): Entry point & container structure.
- [imageWidget.css](file:///d:/Code/ATLAS/frontend/imageWidget.css): Visual styles, animations, and lightbox effects.
- [imageWidget.js](file:///d:/Code/ATLAS/frontend/imageWidget.js): Paging logic, navigation, and API bridge.

