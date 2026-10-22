/**
 * Platform contract file — do not restructure.
 *
 * This file is part of the contract between the slides artifact and
 * the surrounding workspace tooling (preview, thumbnails, exports).
 * Reorganizing it, swapping the router, or changing the structure
 * of `AllSlides` can quietly break that tooling even when the page
 * still looks correct in the preview.
 *
 * Agents: see the slides skill `<workspace_contract>` for the full
 * rules, and `references/visual_qa.md` → "Platform contract sanity
 * check" if this file has been hand-edited and needs repair.
 */

import { useEffect, useRef, useState } from 'react';
import { slides } from '@/slideLoader';
import type { Action } from '@/.sdm/core/schema';
import {
  hasActiveSdmSelection,
  isSdmEditingActive,
} from '@/.sdm/editingState';
import { useLocation } from 'wouter';

function getSlideIndex(pathname: string): number {
  const match = pathname.match(/^\/slide(\d+)$/);
  if (!match) return -1;
  const position = parseInt(match[1], 10);
  return slides.findIndex((s) => s.position === position);
}

const PARENT_OWNS_NAVIGATION =
  new URLSearchParams(window.location.search).get('replitNav') === 'parent' ||
  window.parent !== window.parent.parent;

function SlideEditor() {
  const [location, navigate] = useLocation();
  const currentIndex = getSlideIndex(location);

  const navigationDisabledRef = useRef(PARENT_OWNS_NAVIGATION);
  const touchHandledRefStable = useRef(false);

  useEffect(() => {
    if (currentIndex < 0 || window.parent === window) return;
    window.parent.postMessage(
      {
        type: 'engramPresenterSlideChanged',
        position: slides[currentIndex].position,
      },
      '*',
    );
  }, [currentIndex]);

  useEffect(() => {
    if (currentIndex === -1) return;

    const INTERACTIVE =
      'a,button,video,audio,input,select,textarea,details,summary,iframe,svg,canvas,' +
      '[role="button"],[contenteditable]:not([contenteditable="false"])';

    const isInteractive = (target: EventTarget | null) =>
      (target as HTMLElement | null)?.closest?.(INTERACTIVE);

    const ARROW_KEY_CONSUMERS =
      'input:not([type="button"]):not([type="submit"]):not([type="reset"]),' +
      'select,textarea,audio,video';

    const consumesArrowKeys = (target: EventTarget | null) => {
      if (!(target instanceof HTMLElement)) return false;
      return (
        target.isContentEditable || !!target.closest(ARROW_KEY_CONSUMERS)
      );
    };

    const postNav = (type: 'advanceSlide' | 'retreatSlide') => {
      window.parent.postMessage({ type, source: 'keyboard' }, '*');
    };

    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (hasActiveSdmSelection() || event.defaultPrevented) return;
      if (navigationDisabledRef.current) {
        if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) {
          return;
        }
        if (event.key === ' ') {
          const focused = isInteractive(event.target);
          const role = focused?.getAttribute('role');
          const isPlainLink =
            !!focused &&
            focused.tagName === 'A' &&
            (!role ||
              role === 'link' ||
              role === 'none' ||
              role === 'presentation');
          if (focused && !isPlainLink) return;
          event.preventDefault();
          postNav('advanceSlide');
          return;
        }
        if (consumesArrowKeys(event.target)) return;
        if (
          event.key === 'ArrowLeft' ||
          event.key === 'ArrowUp' ||
          event.key === 'PageUp'
        ) {
          event.preventDefault();
          postNav('retreatSlide');
        }
        if (
          event.key === 'ArrowRight' ||
          event.key === 'ArrowDown' ||
          event.key === 'PageDown'
        ) {
          event.preventDefault();
          postNav('advanceSlide');
        }
        return;
      }
      if (event.key === ' ') {
        event.preventDefault();
      }
      if (
        (event.key === 'ArrowLeft' ||
          event.key === 'ArrowUp' ||
          event.key === 'PageUp') &&
        currentIndex > 0
      ) {
        navigate(`/slide${slides[currentIndex - 1].position}`);
      }
      if (
        (event.key === 'ArrowRight' ||
          event.key === 'ArrowDown' ||
          event.key === 'PageDown' ||
          event.key === ' ') &&
        currentIndex < slides.length - 1
      ) {
        navigate(`/slide${slides[currentIndex + 1].position}`);
      }
    };

    const touchHandledRef = touchHandledRefStable;

    const onClick = (event: MouseEvent) => {
      if (isSdmEditingActive()) return;
      if (touchHandledRef.current) {
        touchHandledRef.current = false;
        return;
      }
      if (event.button !== 0 || event.metaKey || event.ctrlKey) return;
      if (isInteractive(event.target)) return;

      if (navigationDisabledRef.current) {
        window.parent.postMessage({ type: 'advanceSlide' }, '*');
        return;
      }

      if (currentIndex < slides.length - 1) {
        navigate(`/slide${slides[currentIndex + 1].position}`);
      }
    };

    let touchStartX = 0;
    let touchStartY = 0;
    let touchTarget: EventTarget | null = null;

    const onTouchStart = (event: TouchEvent) => {
      touchHandledRef.current = false;
      touchStartX = event.touches[0].clientX;
      touchStartY = event.touches[0].clientY;
      touchTarget = event.target;
    };

    const onTouchEnd = (event: TouchEvent) => {
      if (isSdmEditingActive()) return;
      const dx = event.changedTouches[0].clientX - touchStartX;
      const dy = event.changedTouches[0].clientY - touchStartY;
      if (Math.abs(dx) >= 10 || Math.abs(dy) >= 10) return;
      if (isInteractive(touchTarget)) return;
      touchHandledRef.current = true;

      if (navigationDisabledRef.current) {
        window.parent.postMessage({ type: 'advanceSlide' }, '*');
        return;
      }

      const fraction = touchStartX / window.innerWidth;
      if (fraction < 0.4 && currentIndex > 0) {
        navigate(`/slide${slides[currentIndex - 1].position}`);
      } else if (fraction >= 0.4 && currentIndex < slides.length - 1) {
        navigate(`/slide${slides[currentIndex + 1].position}`);
      }
    };

    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('click', onClick);
    window.addEventListener('touchstart', onTouchStart);
    window.addEventListener('touchend', onTouchEnd);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('click', onClick);
      window.removeEventListener('touchstart', onTouchStart);
      window.removeEventListener('touchend', onTouchEnd);
    };
  }, [currentIndex, navigate]);

  return (
    <div className="select-none">
      {slides.map((slide, index) => (
        <div
          key={slide.id}
          style={{ display: index === currentIndex ? 'block' : 'none' }}
        >
          <slide.Component active={index === currentIndex} />
        </div>
      ))}
    </div>
  );
}

// Do not rewrite this component. Each slide must remain wrapped in
// `<div className="slide">` sized 1920×1080 — the class name and
// dimensions are part of the platform contract. See the file-level
// banner above for context.
function AllSlides() {
  return (
    <div className="bg-black">
      {slides.map((slide) => (
        <div
          key={slide.id}
          data-slide-id={slide.id}
          className="slide relative aspect-video overflow-hidden"
          style={{ width: '1920px', height: '1080px' }}
        >
          <div className="h-full w-full [&_.h-screen]:!h-full [&_.w-screen]:!w-full">
            <slide.Component />
          </div>
        </div>
      ))}
    </div>
  );
}

// This component is used for the deployed view at `/`
function SlideViewer() {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const firstPosition = slides.length > 0 ? slides[0].position : 1;
  const [viewport, setViewport] = useState(() => ({
    width: window.innerWidth,
    height: window.innerHeight,
  }));
  const [currentPosition, setCurrentPosition] = useState(firstPosition);
  const [showNotes, setShowNotes] = useState(false);
  const presenterControlsAvailable =
    import.meta.env.DEV || window.self !== window.top;

  useEffect(() => {
    const update = () => {
      setViewport({
        width: window.innerWidth,
        height: window.innerHeight,
      });
    };
    window.addEventListener('resize', update);
    return () => window.removeEventListener('resize', update);
  }, []);

  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      if (
        event.source !== iframeRef.current?.contentWindow ||
        event.data?.type !== 'engramPresenterSlideChanged' ||
        typeof event.data.position !== 'number' ||
        !slides.some((slide) => slide.position === event.data.position)
      ) {
        return;
      }
      setCurrentPosition(event.data.position);
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, []);

  useEffect(() => {
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (
        event.target instanceof Element &&
        event.target.closest('[data-presenter-notes]')
      ) {
        return;
      }
      if (
        event.key !== 'ArrowLeft' &&
        event.key !== 'ArrowRight' &&
        event.key !== 'PageUp' &&
        event.key !== 'PageDown' &&
        event.key !== ' '
      )
        return;
      if (event.key === ' ') event.preventDefault();
      iframeRef.current?.contentWindow?.dispatchEvent(
        new KeyboardEvent('keydown', {
          key: event.key,
          code: event.code,
          bubbles: true,
        }),
      );
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  const notesPanelWidth = Math.min(360, Math.max(260, viewport.width * 0.3));
  const horizontalSpace = showNotes
    ? viewport.width > 720
      ? notesPanelWidth + 68
      : 24
    : 0;
  const maxSlideHeight =
    showNotes && viewport.width <= 720 ? viewport.height * 0.52 : viewport.height;
  const slideWidth = Math.min(
    Math.max(1, viewport.width - horizontalSpace),
    maxSlideHeight * (16 / 9),
  );
  const dims = { width: slideWidth, height: slideWidth * (9 / 16) };
  const base = import.meta.env.BASE_URL.replace(/\/$/, '');
  const currentSlide =
    slides.find((slide) => slide.position === currentPosition) ?? slides[0];

  return (
    <div
      className={`slide-viewer presenter-viewer h-screen w-screen overflow-hidden bg-black flex items-center justify-center${showNotes ? ' presenter-viewer--with-notes' : ''}`}
      onClick={(event) => {
        if (
          event.target instanceof Element &&
          event.target.closest('[data-presenter-notes]')
        ) {
          return;
        }
        iframeRef.current?.focus();
      }}
    >
      <div
        className="presenter-slide-frame"
        style={{ width: dims.width, height: dims.height }}
      >
        <iframe
          ref={iframeRef}
          src={`${base}/slide${firstPosition}?replitMotion=1`}
          style={{ width: dims.width, height: dims.height, border: 'none' }}
          onLoad={() => iframeRef.current?.focus()}
          title="Slide viewer"
        />
      </div>
      {showNotes && currentSlide ? (
        <aside
          className="presenter-notes-panel"
          data-presenter-notes
          aria-label="Presenter notes"
          aria-live="polite"
        >
          <div className="presenter-notes-heading">
            <div>
              <div className="presenter-notes-kicker">Presenter / Notes</div>
              <div className="presenter-notes-position">
                Slide {String(currentSlide.position).padStart(2, '0')} /{' '}
                {String(slides.length).padStart(2, '0')}
              </div>
            </div>
            <button
              type="button"
              className="presenter-notes-close"
              aria-label="Hide presenter notes"
              onClick={() => setShowNotes(false)}
            >
              ×
            </button>
          </div>
          <h2 className="presenter-notes-title">{currentSlide.title}</h2>
          <div className="presenter-notes-copy">
            {currentSlide.speakerNotes?.trim() ||
              'No presenter notes are available for this slide.'}
          </div>
          <div className="presenter-notes-foot">
            NOTES FOLLOW THE ACTIVE SLIDE
          </div>
        </aside>
      ) : null}
      {presenterControlsAvailable && !showNotes ? (
        <button
          type="button"
          className="presenter-notes-toggle"
          data-presenter-notes
          aria-expanded={showNotes}
          onClick={() => setShowNotes(true)}
        >
          PRESENTER NOTES
        </button>
      ) : null}
    </div>
  );
}

export default function App() {
  const [location, navigate] = useLocation();

  // DO NOT edit this useEffect - redirects unknown routes to the first slide.
  // The "/" and "/allslides" routes are handled separately below.
  useEffect(() => {
    if (
      location !== '/' &&
      location !== '/allslides' &&
      getSlideIndex(location) === -1
    ) {
      if (slides.length > 0) {
        navigate(`/slide${slides[0].position}`, { replace: true });
      }
    }
  }, [location, navigate]);

  // DO NOT edit this useEffect - allows the parent frame to navigate
  // between slides via postMessage so it can avoid changing the iframe
  // src (which causes a white flash).
  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      if (
        event.data?.type === 'navigateToSlide' &&
        typeof event.data.position === 'number' &&
        slides.some((s) => s.position === event.data.position)
      ) {
        navigate(`/slide${event.data.position}`);
      }
    };

    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [navigate]);

  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      if (isSdmEditingActive()) return;
      if (event.source !== window || event.data?.type !== 'sdm:action') {
        return;
      }
      const action = event.data.action as Action | undefined;
      if (!action) {
        return;
      }
      if (action.kind === 'goToSlide') {
        const target = slides.find((slide) => slide.id === action.slideId);
        if (target) {
          navigate(`/slide${target.position}`);
        }
        return;
      }
      if (action.kind !== 'goToRelativeSlide') {
        return;
      }
      if (
        PARENT_OWNS_NAVIGATION &&
        (action.target === 'next' || action.target === 'previous')
      ) {
        window.parent.postMessage(
          {
            type: action.target === 'next' ? 'advanceSlide' : 'retreatSlide',
            source: 'keyboard',
          },
          '*',
        );
        return;
      }
      const current = getSlideIndex(location);
      let targetIndex = current - 1;
      if (action.target === 'first') {
        targetIndex = 0;
      } else if (action.target === 'last') {
        targetIndex = slides.length - 1;
      } else if (action.target === 'next') {
        targetIndex = current + 1;
      }
      const target = slides[targetIndex];
      if (target) {
        navigate(`/slide${target.position}`);
      }
    };

    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [location, navigate]);

  if (location === '/') return <SlideViewer />;
  if (location === '/allslides') return <AllSlides />;
  return <SlideEditor />;
}
