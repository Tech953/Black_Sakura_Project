import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import type { SlideManifestEntry } from '../src/.sdm/core/slidesManifest';
import { validatePresenterNotes } from './validate-slides';

const manifestPath = new URL(
  '../src/data/slides-manifest.json',
  import.meta.url,
);

test('the 30-slide pitch has non-blank presenter notes on every slide', () => {
  const slides = JSON.parse(
    readFileSync(manifestPath, 'utf8'),
  ) as Array<SlideManifestEntry>;

  assert.equal(slides.length, 30);
  assert.deepEqual(validatePresenterNotes(slides), []);
});

test('missing and blank presenter notes identify the slide title and position', () => {
  const issues = validatePresenterNotes([
    {
      position: 4,
      title: 'Identity gives the engram a stable center',
      speakerNotes: '   ',
    },
    {
      position: 19,
      title: 'A mobile presence',
    },
  ]);

  assert.deepEqual(
    issues.map(({ message }) => message),
    [
      'Missing or blank presenter notes for slide 4 "Identity gives the engram a stable center"',
      'Missing or blank presenter notes for slide 19 "A mobile presence"',
    ],
  );
});