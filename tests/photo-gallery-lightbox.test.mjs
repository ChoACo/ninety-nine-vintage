import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const source = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("preserves cyclic keyboard, swipe, thumbnail, and Escape gallery contracts", async () => {
  const [gallery, modal] = await Promise.all([
    source("src/components/feed/PhotoGalleryModal.tsx"),
    source("src/components/common/Modal.tsx"),
  ]);

  assert.match(gallery, /clampIndex\(initialIndex, images\.length\)/);
  assert.match(gallery, /\(current - 1 \+ images\.length\) % images\.length/);
  assert.match(gallery, /\(current \+ 1\) % images\.length/);
  assert.match(gallery, /event\.key === "ArrowLeft"[\s\S]*showPrevious\(\)/);
  assert.match(gallery, /event\.key === "ArrowRight"[\s\S]*showNext\(\)/);
  assert.match(gallery, /document\.addEventListener\("keydown", handleArrowKeys\)/);
  assert.match(gallery, /document\.removeEventListener\("keydown", handleArrowKeys\)/);
  assert.match(gallery, /Math\.abs\(distance\) < 45/);
  assert.match(gallery, /distance > 0\) showPrevious\(\);[\s\S]*else showNext\(\)/);
  assert.match(gallery, /onClick=\{\(\) => setActiveIndex\(index\)\}/);
  assert.match(gallery, /aria-current=\{index === activeIndex \? "true" : undefined\}/);

  assert.match(modal, /event\.key === "Escape"[\s\S]*onCloseRef\.current\(\)/);
  assert.match(modal, /document\.body\.style\.overflow = "hidden"/);
  assert.match(modal, /previousActiveElement\?\.focus\(\)/);
});

test("uses a high-resolution image with an independent lightweight zoom layer", async () => {
  const gallery = await source("src/components/feed/PhotoGalleryModal.tsx");

  assert.match(gallery, /function ZoomableGalleryImage/);
  assert.match(gallery, /src=\{images\[activeIndex\]\}/);
  assert.match(gallery, /src=\{thumbnailImages\?\.\[index\] \|\| image\}/);
  assert.match(gallery, /const \[isZoomed, setIsZoomed\] = useState\(false\)/);
  assert.match(gallery, /aria-pressed=\{isZoomed\}/);
  assert.match(gallery, /cursor-zoom-out[\s\S]*cursor-zoom-in/);
  assert.match(gallery, /scale-\[2\.5\]/);
  assert.match(gallery, /onPointerMove=\{updateZoomOrigin\}/);
  assert.match(gallery, /event\.pointerType === "touch"/);
  assert.match(gallery, /window\.requestAnimationFrame/);
  assert.match(gallery, /window\.cancelAnimationFrame/);
  assert.match(gallery, /--zoom-origin-x/);
  assert.match(gallery, /key=\{`\$\{images\[activeIndex\]\}-\$\{activeIndex\}`\}/);
});

test("renders a truthful editorial LOT header without the malformed legacy label", async () => {
  const [postCard, gallery, galleryModal, modal] = await Promise.all([
    source("src/components/feed/PostCard.tsx"),
    source("src/components/feed/PhotoGallery.tsx"),
    source("src/components/feed/PhotoGalleryModal.tsx"),
    source("src/components/common/Modal.tsx"),
  ]);

  assert.match(postCard, /post\.title[\s\S]*\.normalize\("NFKC"\)[\s\S]*\.replace\(\/\^\\s\*\\\[/);
  assert.match(postCard, /post\.id\.slice\(0, 8\)\.toUpperCase\(\)/);
  assert.match(postCard, /lotLabel=\{galleryLotLabel\}/);
  assert.match(gallery, /lotLabel=\{lotLabel\}/);
  assert.match(galleryModal, /title=\{title\}/);
  assert.doesNotMatch(galleryModal, /사진 전체보기 · \$\{title\}/);
  assert.match(galleryModal, /headerPrefix=\{lotLabel\}/);
  assert.match(galleryModal, /closeShortcutLabel="ESC"/);
  assert.match(galleryModal, /headerVariant="editorial"/);
  assert.match(modal, /font-mono text-\[10px\] font-black tabular-nums/);
  assert.match(modal, /text-xs font-medium leading-5 text-zinc-500/);
  assert.match(modal, /\[ \{closeShortcutLabel\} \]/);
});

test("uses glass navigation and precision active thumbnail treatment", async () => {
  const gallery = await source("src/components/feed/PhotoGalleryModal.tsx");

  assert.match(gallery, /aria-label="이전 사진"/);
  assert.match(gallery, /aria-label="다음 사진"/);
  assert.match(gallery, /rounded-full border border-white\/10 bg-black\/40/);
  assert.match(gallery, /backdrop-blur-md/);
  assert.match(gallery, /hover:scale-110/);
  assert.match(gallery, /hover:bg-black\/60/);
  assert.match(gallery, /scale-105 border-white opacity-100 brightness-110/);
  assert.match(gallery, /border-transparent opacity-50 hover:scale-\[1\.03\] hover:opacity-80/);
  assert.match(gallery, /images\.length > 1/);
});
