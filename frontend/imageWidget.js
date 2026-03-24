/**
 * Image Widget — Adaptive Layout System
 *
 * Layout modes (applied as CSS class on .image-widget-content):
 *   layout-single      → 1 image   : large, prominent, object-fit:contain
 *   layout-duo         → 2 images  : side-by-side row
 *   layout-trio        → 3 images  : single row of three
 *   layout-quad        → 4 images  : 2×2 grid
 *   layout-grid-compact→ 5–6 images: 3×2 compact grid (no pagination)
 *   layout-paged       → 7+ images : sliding 3×2 paginated grid
 */

// ─── DOM References ───────────────────────────────────────────────────────────
const imageWidgetContainer = document.getElementById('image-widget-container');
const imageWidgetContent   = imageWidgetContainer?.querySelector('.image-widget-content');
const imageWidgetViewport  = imageWidgetContainer?.querySelector('.image-widget-viewport');
const imageWidgetGrid      = document.getElementById('image-widget-grid');
const imageWidgetClose     = document.getElementById('image-widget-close');
const imageNavPrev         = document.getElementById('image-nav-prev');
const imageNavNext         = document.getElementById('image-nav-next');
const imagePagination      = document.getElementById('image-widget-pagination');

// Lightbox
const lightboxContainer = document.getElementById('lightbox-container');
const lightboxImage     = document.getElementById('lightbox-image');
const lightboxCaption   = document.getElementById('lightbox-caption');
const lightboxClose     = document.getElementById('lightbox-close');

// ─── State ────────────────────────────────────────────────────────────────────
let currentImagePage = 0;
let totalImagePages  = 0;

// ─── Layout Helpers ───────────────────────────────────────────────────────────
const LAYOUT_MODES = ['layout-single','layout-duo','layout-trio',
                      'layout-quad','layout-grid-compact','layout-paged'];

/**
 * Returns the layout class name for a given image count.
 * @param {number} count
 * @returns {string}
 */
function getLayoutMode(count) {
    if (count === 1) return 'layout-single';
    if (count === 2) return 'layout-duo';
    if (count === 3) return 'layout-trio';
    if (count === 4) return 'layout-quad';
    if (count <= 6)  return 'layout-grid-compact';
    return 'layout-paged';
}

/**
 * Applies a layout class to .image-widget-content,
 * removing any previously applied layout class.
 * @param {string} mode
 */
function applyLayoutMode(mode) {
    if (!imageWidgetContent) return;
    LAYOUT_MODES.forEach(m => imageWidgetContent.classList.remove(m));
    imageWidgetContent.classList.add(mode);
}

// ─── Lightbox ─────────────────────────────────────────────────────────────────
function openLightbox(url, name) {
    if (!lightboxContainer || !lightboxImage) return;
    lightboxImage.src = url;
    if (lightboxCaption) lightboxCaption.innerText = name || 'VISUAL_FEED';
    lightboxContainer.style.display = 'flex';
}

function closeLightbox() {
    if (lightboxContainer) lightboxContainer.style.display = 'none';
}

// ─── Card Builder ─────────────────────────────────────────────────────────────
/**
 * Creates a single image card element.
 * @param {{ url: string, name?: string }} img
 * @returns {HTMLElement}
 */
function buildImageCard(img) {
    const item = document.createElement('div');
    item.className = 'image-item';
    item.style.cursor = 'zoom-in';

    const imgContainer = document.createElement('div');
    imgContainer.className = 'image-item-img-container';

    const imageEl = document.createElement('img');
    imageEl.src = img.url;
    imageEl.alt = img.name || 'Image';
    imageEl.loading = 'lazy';
    imgContainer.appendChild(imageEl);

    const infoDiv = document.createElement('div');
    infoDiv.className = 'image-item-info';

    const nameLabel = document.createElement('div');
    nameLabel.className = 'image-item-name';
    nameLabel.innerText = img.name || 'UNNAMED_DATA';

    const metaLabel = document.createElement('div');
    metaLabel.className = 'image-item-meta';
    metaLabel.innerText = 'VISUAL_FEED_DATA';

    infoDiv.appendChild(nameLabel);
    infoDiv.appendChild(metaLabel);
    item.appendChild(imgContainer);
    item.appendChild(infoDiv);

    item.onclick = () => openLightbox(img.url, img.name || 'VISUAL_FEED');
    return item;
}

// ─── Main: showImage ──────────────────────────────────────────────────────────
/**
 * Shows the image widget with the provided data.
 * @param {string|Array|Object} data
 */
function showImage(data) {
    if (!imageWidgetContainer || !imageWidgetGrid) return;

    // Reset
    imageWidgetGrid.innerHTML = '';
    if (imagePagination) imagePagination.innerHTML = '';
    currentImagePage = 0;
    imageWidgetGrid.style.transform = 'translateX(0)';

    // Normalise input into an array of { url, name } objects
    let images = [];
    if (typeof data === 'string') {
        images = [{ url: data, name: 'IMAGE FEED' }];
    } else if (Array.isArray(data)) {
        images = data;
    } else if (data && typeof data === 'object' && data.images) {
        images = data.images;
    } else if (data && typeof data === 'object' && data.url) {
        images = [{ url: data.url, name: data.name || 'IMAGE FEED' }];
    }

    if (!images.length) return;

    const mode = getLayoutMode(images.length);
    applyLayoutMode(mode);

    // ── Non-paginated layouts (1–6): single page, no nav arrows ──────────────
    if (mode !== 'layout-paged') {
        // Hide nav arrows — not needed for a single page
        if (imageNavPrev) imageNavPrev.classList.add('disabled');
        if (imageNavNext) imageNavNext.classList.add('disabled');
        totalImagePages = 1;

        const pageDiv = document.createElement('div');
        pageDiv.className = 'image-widget-page';
        images.forEach(img => pageDiv.appendChild(buildImageCard(img)));
        imageWidgetGrid.appendChild(pageDiv);

    // ── Paginated layout (7+): chunked 3×2 pages with nav ────────────────────
    } else {
        const chunkSize = 6;
        const chunks = [];
        for (let i = 0; i < images.length; i += chunkSize) {
            chunks.push(images.slice(i, i + chunkSize));
        }
        totalImagePages = chunks.length;

        chunks.forEach((chunk, pageIndex) => {
            const pageDiv = document.createElement('div');
            pageDiv.className = 'image-widget-page';
            chunk.forEach(img => pageDiv.appendChild(buildImageCard(img)));
            imageWidgetGrid.appendChild(pageDiv);

            if (imagePagination && totalImagePages > 1) {
                const dot = document.createElement('div');
                dot.className = `page-dot ${pageIndex === 0 ? 'active' : ''}`;
                dot.onclick = () => scrollToImagePage(pageIndex);
                imagePagination.appendChild(dot);
            }
        });

        updateImageNav();
    }

    imageWidgetContainer.style.display = 'flex';
    console.log(`[ImageWidget] Showing ${images.length} image(s) in mode: ${mode}`);
}

// ─── Paged Navigation ─────────────────────────────────────────────────────────
function scrollToImagePage(index) {
    if (index < 0 || index >= totalImagePages) return;
    currentImagePage = index;

    const pageWidth = imageWidgetViewport ? imageWidgetViewport.offsetWidth : 912;
    imageWidgetGrid.style.transform = `translateX(-${index * pageWidth}px)`;

    if (imagePagination) {
        imagePagination.querySelectorAll('.page-dot').forEach((dot, i) => {
            dot.classList.toggle('active', i === index);
        });
    }
    updateImageNav();
}

function updateImageNav() {
    if (!imageNavPrev || !imageNavNext) return;
    if (totalImagePages <= 1) {
        imageNavPrev.classList.add('disabled');
        imageNavNext.classList.add('disabled');
    } else {
        imageNavPrev.classList.toggle('disabled', currentImagePage === 0);
        imageNavNext.classList.toggle('disabled', currentImagePage === totalImagePages - 1);
    }
}

// ─── Hide ─────────────────────────────────────────────────────────────────────
function hideImage() {
    if (!imageWidgetContainer) return;
    imageWidgetContainer.style.display = 'none';
    if (imageWidgetGrid) {
        imageWidgetGrid.innerHTML = '';
        imageWidgetGrid.style.transform = 'translateX(0)';
    }
    if (imagePagination) imagePagination.innerHTML = '';
    // Remove layout class so it's clean on next open
    if (imageWidgetContent) {
        LAYOUT_MODES.forEach(m => imageWidgetContent.classList.remove(m));
    }
}

// ─── Event Listeners ──────────────────────────────────────────────────────────
if (imageNavPrev) imageNavPrev.onclick = () => scrollToImagePage(currentImagePage - 1);
if (imageNavNext) imageNavNext.onclick = () => scrollToImagePage(currentImagePage + 1);
if (imageWidgetClose) imageWidgetClose.onclick = hideImage;

if (lightboxClose) lightboxClose.onclick = closeLightbox;
if (lightboxContainer) {
    lightboxContainer.onclick = (e) => {
        if (e.target === lightboxContainer) closeLightbox();
    };
}

// Maintain scroll position on resize (paged mode only)
window.addEventListener('resize', () => {
    if (imageWidgetContainer?.style.display === 'flex' &&
        imageWidgetContent?.classList.contains('layout-paged')) {
        scrollToImagePage(currentImagePage);
    }
});

// Escape key
window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
        if (lightboxContainer?.style.display === 'flex') {
            closeLightbox();
        } else {
            hideImage();
        }
    }
});

// ─── Global API ───────────────────────────────────────────────────────────────
window.imageWidget = { show: showImage, hide: hideImage };