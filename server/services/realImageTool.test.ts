import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildSearchUrl,
  formatCredit,
  isAllowedLicense,
  parseSearchResponse,
} from './realImageTool';

describe('realImageTool license gate', () => {
  it('chỉ cho PD/CC0/CC-BY/CC-BY-SA, chặn OTHER (tránh dính bản quyền)', () => {
    assert.equal(isAllowedLicense('PD'), true);
    assert.equal(isAllowedLicense('CC0'), true);
    assert.equal(isAllowedLicense('CC-BY'), true);
    assert.equal(isAllowedLicense('CC-BY-SA'), true);
    assert.equal(isAllowedLicense('OTHER'), false);
  });

  it('formatCredit giống mẫu Bạch Đằng: Ảnh + tác giả + nguồn + license', () => {
    assert.equal(
      formatCredit('Binh Giang', 'PD'),
      'Ảnh: Binh Giang • Wikimedia • Public domain',
    );
  });
});

describe('realImageTool wikimedia parsing', () => {
  it('lọc ảnh <1280px và license OTHER', () => {
    const json = {
      query: {
        pages: {
          1: {
            title: 'File:Bach Dang stakes.jpg',
            imageinfo: [{
              url: 'https://upload.wikimedia.org/big.jpg',
              width: 2000,
              height: 1200,
              extmetadata: {
                Artist: { value: '<a>Binh Giang</a>' },
                LicenseShortName: { value: 'Public domain' },
                UsageTerms: { value: 'Public domain' },
              },
            }],
          },
          2: {
            title: 'File:Too small.jpg',
            imageinfo: [{
              url: 'https://upload.wikimedia.org/small.jpg',
              width: 640,
              height: 400,
              extmetadata: {
                Artist: { value: 'Someone' },
                LicenseShortName: { value: 'Public domain' },
                UsageTerms: { value: 'Public domain' },
              },
            }],
          },
          3: {
            title: 'File:Nonfree.jpg',
            imageinfo: [{
              url: 'https://upload.wikimedia.org/nonfree.jpg',
              width: 2000,
              height: 1200,
              extmetadata: {
                Artist: { value: 'Someone' },
                LicenseShortName: { value: 'All rights reserved' },
                UsageTerms: { value: 'Non-free' },
              },
            }],
          },
        },
      },
    };
    const out = parseSearchResponse(json, 1280);
    assert.equal(out.length, 1);
    assert.equal(out[0].title, 'Bach Dang stakes.jpg');
    assert.equal(out[0].author, 'Binh Giang');
    assert.equal(out[0].license, 'PD');
    assert.match(out[0].credit, /Binh Giang/);
    assert.match(out[0].pageUrl, /commons\.wikimedia\.org/);
  });

  it('buildSearchUrl luôn query namespace File + filter bitmap', () => {
    const url = buildSearchUrl('coc Bach Dang 1288', 8);
    assert.match(url, /commons\.wikimedia\.org/);
    assert.match(url, /gsrnamespace=6/);
    assert.match(url, /filetype%3Abitmap|filetype:bitmap/i);
  });
});
