import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { square } from '../helpers';
test('example, reciprocal seam details, numeric IDs, and vector PDF download', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Download tiled PDF' })).toBeDisabled();
  await page.getByRole('button', { name: 'Try an example' }).click();
  await expect(page.locator('#stat-sheets')).toContainText('12');
  await expect(page.locator('#neighbors')).toContainText('A1:B1');
  await page.selectOption('#sheet-select', '1');
  await expect(page.locator('#neighbors')).toContainText('A1:B1');
  await page.getByRole('button', { name: 'Single sheet', exact: true }).click();
  await expect(page.locator('#preview')).toContainText('A1:B1');
  await page.selectOption('#labels', 'numbers');
  await expect(page.locator('#selected-sheet')).toContainText('2');
  await page.locator('#confirm').check();
  const event = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download tiled PDF' }).click();
  const download = await event;
  expect(download.suggestedFilename()).toBe('workshop-example-tiled.pdf');
  expect(await download.failure()).toBeNull();
  expect(errors).toEqual([]);
});
test('file import, invalid settings and scale confirmation', async ({ page }) => {
  await page.goto('/');
  await page.setInputFiles('#file', {
    name: 'square.dxf',
    mimeType: 'application/dxf',
    buffer: Buffer.from(square()),
  });
  await expect(page.locator('#stat-size')).toContainText('100.0 × 100.0');
  await page.locator('#confirm').check();
  await expect(page.locator('#download')).toBeEnabled();
  await page.selectOption('#units', 'in');
  await expect(page.locator('#confirm')).not.toBeChecked();
  await page.fill('#margin', '-1');
  await expect(page.locator('#status')).toContainText('margins');
  await expect(page.locator('#download')).toBeDisabled();
});
test('responsive UI meets automated WCAG AA checks without sending files off-device', async ({
  page,
}) => {
  const external: string[] = [];
  page.on('request', (r) => {
    if (!r.url().startsWith('http://127.0.0.1:4173') && !r.url().startsWith('data:'))
      external.push(r.url());
  });
  await page.goto('/');
  await page.getByRole('button', { name: 'Try an example' }).click();
  await expect(page.locator('#stat-size')).toContainText('420.0');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  const result = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
    .analyze();
  expect(result.violations).toEqual([]);
  expect(external).toEqual([]);
});
test('multiple files can be nested, assigned separate units and removed', async ({ page }) => {
  await page.goto('/');
  await page.setInputFiles('#file', [
    { name: 'first.dxf', mimeType: 'application/dxf', buffer: Buffer.from(square(50)) },
    { name: 'second.dxf', mimeType: 'application/dxf', buffer: Buffer.from(square(50)) },
  ]);
  await expect(page.locator('#filename')).toContainText('2 DXF');
  await expect(page.locator('#stat-sheets')).toContainText('1');
  await expect(page.locator('#nest-info')).toContainText('2 drawings');
  await page.locator('#skip-empty').check();
  await page.selectOption('#orientation', 'landscape');
  await expect(page.locator('#stat-sheets')).toContainText('1');
  await page.getByRole('button', { name: 'Remove first.dxf' }).click();
  await expect(page.locator('#filename')).toContainText('second.dxf');
  await expect(page.locator('#stat-size')).toContainText('50.0 × 50.0');
});
