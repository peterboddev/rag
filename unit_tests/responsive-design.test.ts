/**
 * Unit tests for responsive design and mobile optimization.
 * Validates CSS media queries and responsive rules in index.css.
 * Requirements: 2.2, 2.3, 8.1
 */

import { describe, it, expect, beforeAll } from '@jest/globals';
import * as fs from 'fs';
import * as path from 'path';

let cssContent: string;

beforeAll(() => {
  cssContent = fs.readFileSync(
    path.join(__dirname, '..', 'frontend', 'src', 'index.css'),
    'utf-8'
  );
});

describe('Responsive Design - Media Queries', () => {
  it('should have a tablet breakpoint at max-width 1024px', () => {
    expect(cssContent).toContain('@media (max-width: 1024px)');
  });

  it('should have a mobile breakpoint at max-width 768px', () => {
    expect(cssContent).toContain('@media (max-width: 768px)');
  });

  it('should have a small mobile breakpoint at max-width 480px', () => {
    expect(cssContent).toContain('@media (max-width: 480px)');
  });

  it('should have a touch device media query using pointer: coarse', () => {
    expect(cssContent).toContain('@media (pointer: coarse)');
  });
});

describe('Requirement 2.2 - Desktop layout proportions', () => {
  it('should use a three-column grid layout on desktop', () => {
    // The base .three-column-layout uses grid-template-columns: 1fr 1fr 1fr
    expect(cssContent).toMatch(/\.three-column-layout\s*\{[^}]*grid-template-columns:\s*1fr\s+1fr\s+1fr/);
  });
});

describe('Requirement 2.3 - Narrow screen vertical stacking', () => {
  it('should stack to single column at 768px breakpoint', () => {
    // Extract the 768px media query block
    const mobileMediaMatch = cssContent.match(
      /@media\s*\(\s*max-width:\s*768px\s*\)\s*\{([\s\S]*?)(?=\n\/\*|\n@media|\n\}[^}]*$)/
    );
    expect(mobileMediaMatch).not.toBeNull();
    const mobileBlock = mobileMediaMatch![1];
    expect(mobileBlock).toContain('grid-template-columns: 1fr');
  });

  it('should use auto rows for vertical stacking at 768px', () => {
    const mobileMediaMatch = cssContent.match(
      /@media\s*\(\s*max-width:\s*768px\s*\)\s*\{([\s\S]*?)(?=\n\/\*|\n@media|\n\}[^}]*$)/
    );
    expect(mobileMediaMatch).not.toBeNull();
    const mobileBlock = mobileMediaMatch![1];
    expect(mobileBlock).toContain('grid-template-rows: auto auto auto');
  });

  it('should remove right borders on columns at mobile', () => {
    const mobileMediaMatch = cssContent.match(
      /@media\s*\(\s*max-width:\s*768px\s*\)\s*\{([\s\S]*?)(?=\n\/\*|\n@media|\n\}[^}]*$)/
    );
    expect(mobileMediaMatch).not.toBeNull();
    const mobileBlock = mobileMediaMatch![1];
    expect(mobileBlock).toContain('border-right: none');
    expect(mobileBlock).toContain('border-bottom: 1px solid #ddd');
  });
});

describe('Requirement 8.1 - Responsive across devices', () => {
  it('should transition to two-column layout on tablet (1024px)', () => {
    const tabletMediaMatch = cssContent.match(
      /@media\s*\(\s*max-width:\s*1024px\s*\)\s*\{([\s\S]*?)(?=\n\/\*|\n@media|\n\}[^}]*$)/
    );
    expect(tabletMediaMatch).not.toBeNull();
    const tabletBlock = tabletMediaMatch![1];
    expect(tabletBlock).toContain('grid-template-columns: 1fr 1fr');
  });

  it('should span the right column full width on tablet', () => {
    const tabletMediaMatch = cssContent.match(
      /@media\s*\(\s*max-width:\s*1024px\s*\)\s*\{([\s\S]*?)(?=\n\/\*|\n@media|\n\}[^}]*$)/
    );
    expect(tabletMediaMatch).not.toBeNull();
    const tabletBlock = tabletMediaMatch![1];
    // column-right should span both columns
    expect(tabletBlock).toContain('grid-column: 1 / -1');
  });

  it('should reduce container padding on smaller screens', () => {
    // 1024px: 16px, 768px: 12px, 480px: 8px
    expect(cssContent).toMatch(/@media\s*\(\s*max-width:\s*1024px\s*\)[\s\S]*?\.container\s*\{[^}]*padding:\s*16px/);
    expect(cssContent).toMatch(/@media\s*\(\s*max-width:\s*768px\s*\)[\s\S]*?\.container\s*\{[^}]*padding:\s*12px/);
    expect(cssContent).toMatch(/@media\s*\(\s*max-width:\s*480px\s*\)[\s\S]*?\.container\s*\{[^}]*padding:\s*8px/);
  });
});

describe('Touch-friendly interactions', () => {
  it('should set minimum 44px height for buttons on mobile', () => {
    const mobileMediaMatch = cssContent.match(
      /@media\s*\(\s*max-width:\s*768px\s*\)\s*\{([\s\S]*?)(?=\n\/\*|\n@media|\n\}[^}]*$)/
    );
    expect(mobileMediaMatch).not.toBeNull();
    const mobileBlock = mobileMediaMatch![1];
    expect(mobileBlock).toContain('min-height: 44px');
  });

  it('should set minimum 44px tap targets for document item buttons on mobile', () => {
    const mobileMediaMatch = cssContent.match(
      /@media\s*\(\s*max-width:\s*768px\s*\)\s*\{([\s\S]*?)(?=\n\/\*|\n@media|\n\}[^}]*$)/
    );
    expect(mobileMediaMatch).not.toBeNull();
    const mobileBlock = mobileMediaMatch![1];
    expect(mobileBlock).toContain('.document-item button');
    expect(mobileBlock).toMatch(/\.document-item button\s*\{[^}]*min-height:\s*44px/);
  });

  it('should increase tap targets on touch devices (pointer: coarse)', () => {
    const touchMediaMatch = cssContent.match(
      /@media\s*\(\s*pointer:\s*coarse\s*\)\s*\{([\s\S]*?)\n\}/
    );
    expect(touchMediaMatch).not.toBeNull();
    const touchBlock = touchMediaMatch![1];
    expect(touchBlock).toContain('min-height: 48px');
    expect(touchBlock).toContain('min-height: 44px');
  });

  it('should increase checkbox size on touch devices', () => {
    const touchMediaMatch = cssContent.match(
      /@media\s*\(\s*pointer:\s*coarse\s*\)\s*\{([\s\S]*?)\n\}/
    );
    expect(touchMediaMatch).not.toBeNull();
    const touchBlock = touchMediaMatch![1];
    expect(touchBlock).toContain('input[type="checkbox"]');
    expect(touchBlock).toMatch(/width:\s*20px/);
    expect(touchBlock).toMatch(/height:\s*20px/);
  });
});

describe('Responsive font sizes', () => {
  it('should reduce heading font sizes on mobile', () => {
    const mobileMediaMatch = cssContent.match(
      /@media\s*\(\s*max-width:\s*768px\s*\)\s*\{([\s\S]*?)(?=\n\/\*|\n@media|\n\}[^}]*$)/
    );
    expect(mobileMediaMatch).not.toBeNull();
    const mobileBlock = mobileMediaMatch![1];
    expect(mobileBlock).toMatch(/h2\s*\{[^}]*font-size:\s*1\.4rem/);
    expect(mobileBlock).toMatch(/h3\s*\{[^}]*font-size:\s*1\.1rem/);
  });

  it('should use 16px font for inputs to prevent iOS zoom', () => {
    // Check that form inputs use 16px font-size in responsive contexts
    expect(cssContent).toMatch(/\.form-group input[\s\S]*?font-size:\s*16px/);
  });
});

describe('Layout graceful degradation', () => {
  it('should set height to auto on tablet and mobile layouts', () => {
    // Tablet
    const tabletMatch = cssContent.match(
      /@media\s*\(\s*max-width:\s*1024px\s*\)[\s\S]*?\.three-column-layout\s*\{[^}]*height:\s*auto/
    );
    expect(tabletMatch).not.toBeNull();

    // Mobile
    const mobileMatch = cssContent.match(
      /@media\s*\(\s*max-width:\s*768px\s*\)[\s\S]*?\.three-column-layout\s*\{[^}]*height:\s*auto/
    );
    expect(mobileMatch).not.toBeNull();
  });

  it('should set minimum heights for columns to ensure usability', () => {
    // Tablet columns should have min-height
    const tabletMatch = cssContent.match(
      /@media\s*\(\s*max-width:\s*1024px\s*\)[\s\S]*?\.column\s*\{[^}]*min-height:\s*300px/
    );
    expect(tabletMatch).not.toBeNull();

    // Mobile columns should have min-height
    const mobileMatch = cssContent.match(
      /@media\s*\(\s*max-width:\s*768px\s*\)[\s\S]*?\.column\s*\{[^}]*min-height:\s*200px/
    );
    expect(mobileMatch).not.toBeNull();
  });

  it('should make buttons full-width on small mobile', () => {
    const smallMobileMatch = cssContent.match(
      /@media\s*\(\s*max-width:\s*480px\s*\)[\s\S]*?\.btn\s*\{[^}]*width:\s*100%/
    );
    expect(smallMobileMatch).not.toBeNull();
  });
});
