import { logger } from '~test/util.ts';
import { defaultVersioning } from '../versioning/index.ts';
import {
  applyConstraintsFiltering,
  applyExtractVersion,
  applyVersionCompatibility,
  filterValidVersions,
  getDatasourceFor,
  getDefaultVersioning,
  isGetPkgReleasesConfig,
  sortAndRemoveDuplicates,
} from './common.ts';
import { CustomDatasource } from './custom/index.ts';
import { NpmDatasource } from './npm/index.ts';
import type { ReleaseResult } from './types.ts';

describe('modules/datasource/common', () => {
  describe('getDatasourceFor', () => {
    it('returns null for unknown datasource', () => {
      expect(getDatasourceFor('foobar')).toBeNull();
    });

    it('supports custom datasource', () => {
      expect(getDatasourceFor('custom.foobar')).toEqual(
        getDatasourceFor(CustomDatasource.id),
      );
    });

    it('returns datasource for known datasource', () => {
      expect(getDatasourceFor('npm')).toMatchObject({
        id: NpmDatasource.id,
      });
    });
  });

  describe('getDefaultVersioning', () => {
    it('returns default versioning for undefined datasource', () => {
      expect(getDefaultVersioning(undefined)).toBe(defaultVersioning.id);
    });

    it('returns default versioning for unknown datasource', () => {
      expect(getDefaultVersioning('foobar')).toBe(defaultVersioning.id);

      expect(logger.logger.warn).toHaveBeenCalledWith(
        { datasourceName: 'foobar' },
        'Missing datasource!',
      );
    });

    it('returns default versioning for datasource with missing default versioning configuration', () => {
      expect(getDefaultVersioning('artifactory')).toBe(defaultVersioning.id);
    });

    it('returns datasource-defined default versioning', () => {
      expect(getDefaultVersioning('crate')).toBe('cargo');
    });
  });

  describe('isGetPkgReleasesConfig', () => {
    it('returns true for valid input', () => {
      const input = {
        datasource: 'npm',
        packageName: 'lodash',
      };
      expect(isGetPkgReleasesConfig(input)).toBe(true);
    });

    it('returns false for invalid input', () => {
      const input = {
        datasource: '',
        packageName: 'lodash',
      };
      expect(isGetPkgReleasesConfig(input)).toBe(false);
    });

    it('returns false for input with missing properties', () => {
      const input = {
        datasource: 'npm',
      };
      expect(isGetPkgReleasesConfig(input)).toBe(false);
    });

    it('returns false for input with non-string properties', () => {
      const input = {
        datasource: 123,
        packageName: 'lodash',
      };
      expect(isGetPkgReleasesConfig(input)).toBe(false);
    });
  });

  describe('applyExtractVersion', () => {
    it('should return the same release result if extractVersion is not defined', () => {
      const releaseResult: ReleaseResult = {
        releases: [{ version: '1.0.0' }, { version: '2.0.0' }],
      };
      const res = applyExtractVersion(releaseResult, undefined);
      expect(res).toBe(releaseResult);
    });

    it('should extract version from release using provided regex', () => {
      const releaseResult: ReleaseResult = {
        releases: [{ version: 'v1.0.0' }, { version: 'v2.0.0' }],
      };
      const res = applyExtractVersion(releaseResult, '^v(?<version>.+)$');
      expect(res).toEqual({
        releases: [
          { version: '1.0.0', versionOrig: 'v1.0.0' },
          { version: '2.0.0', versionOrig: 'v2.0.0' },
        ],
      });
    });

    it('should return null for releases with invalid version', () => {
      const releaseResult: ReleaseResult = {
        releases: [{ version: 'v1.0.0' }, { version: 'invalid' }],
      };
      const result = applyExtractVersion(releaseResult, '^v(?<version>.+)$');
      expect(result).toEqual({
        releases: [{ version: '1.0.0', versionOrig: 'v1.0.0' }],
      });
    });
  });

  describe('filterValidVersions', () => {
    const releaseResult: ReleaseResult = {
      releases: [
        { version: '1.0.0' },
        { version: '2.0.0' },
        { version: 'invalid' },
      ],
    };

    it('should filter out invalid versions', () => {
      const config = { datasource: 'npm' };
      const res = filterValidVersions(releaseResult, config);
      expect(res).toEqual({
        releases: [{ version: '1.0.0' }, { version: '2.0.0' }],
      });
    });

    it('should use default versioning if none is specified', () => {
      const config = { datasource: 'foobar' };
      const res = filterValidVersions(releaseResult, config);
      expect(res).toEqual({
        releases: [{ version: '1.0.0' }, { version: '2.0.0' }],
      });
    });

    it('should use specified versioning if provided', () => {
      const config = { datasource: 'npm', versioning: 'semver' };
      const res = filterValidVersions(releaseResult, config);
      expect(res).toEqual({
        releases: [{ version: '1.0.0' }, { version: '2.0.0' }],
      });
    });
  });

  describe('sortAndRemoveDuplicates', () => {
    it('sorts releases by version and removes duplicates', () => {
      const config = { datasource: 'npm' };
      const releaseResult: ReleaseResult = {
        releases: [
          { version: '2.0.0' },
          { version: '1.0.0' },
          { version: '1.0.0' },
          { version: '3.0.0' },
        ],
      };
      const expected: ReleaseResult = {
        releases: [
          { version: '1.0.0' },
          { version: '2.0.0' },
          { version: '3.0.0' },
        ],
      };
      const result = sortAndRemoveDuplicates(releaseResult, config);
      expect(result).toEqual(expected);
    });

    it('uses default versioning if none is specified', () => {
      const config = { datasource: 'foobar' };
      const releaseResult: ReleaseResult = {
        releases: [{ version: '1.0.0' }, { version: '2.0.0' }],
      };
      const result = sortAndRemoveDuplicates(releaseResult, config);
      expect(result).toEqual({
        releases: [{ version: '1.0.0' }, { version: '2.0.0' }],
      });

      expect(logger.logger.warn).toHaveBeenCalledWith(
        { datasourceName: 'foobar' },
        'Missing datasource!',
      );
    });
  });

  describe('applyConstraintsFiltering', () => {
    it('should remove constraints from releases if constraintsFiltering is not strict', () => {
      const config = {
        datasource: 'foo',
        packageName: 'bar',
        constraintsFiltering: 'none' as const,
      };
      const releaseResult: ReleaseResult = {
        releases: [
          { version: '1.0.0', constraints: { foo: ['^1.0.0'] } },
          { version: '2.0.0', constraints: { foo: ['^2.0.0'] } },
        ],
      };
      expect(applyConstraintsFiltering(releaseResult, config)).toEqual({
        releases: [{ version: '1.0.0' }, { version: '2.0.0' }],
      });
    });

    it('should filter releases based on constraints if constraintsFiltering is strict', () => {
      const config = {
        datasource: 'foo',
        packageName: 'bar',
        constraintsFiltering: 'strict' as const,
        constraints: { baz: '^1.0.0', qux: 'invalid' },
      };
      const releaseResult = {
        releases: [
          { version: '1.0.0' },
          { version: '2.0.0', constraints: { baz: [undefined] } as never },
          { version: '3.0.0', constraints: { baz: ['^0.9.0', 'invalid'] } },
        ],
      };
      expect(applyConstraintsFiltering(releaseResult, config)).toEqual({
        releases: [{ version: '1.0.0' }, { version: '2.0.0' }],
      });
    });

    it('should match exact constraints', () => {
      const config = {
        datasource: 'pypi',
        packageName: 'bar',
        versioning: 'pep440',
        constraintsFiltering: 'strict' as const,
        constraints: { python: '>=3.8' },
      };
      const releaseResult = {
        releases: [
          { version: '1.0.0', constraints: { python: ['^1.0.0'] } },
          { version: '2.0.0', constraints: { python: ['>=3.8'] } },
        ],
      };
      expect(applyConstraintsFiltering(releaseResult, config)).toEqual({
        releases: [{ version: '2.0.0' }],
      });
    });
  });

  describe('applyVersionCompatibility', () => {
    const applyVersionCompatibilityWithCompatibilityVersioning =
      applyVersionCompatibility as (
        releaseResult: ReleaseResult,
        versionCompatibility: string | undefined,
        currentCompatibility: string | undefined,
        compatibilityVersioning?: string,
      ) => ReleaseResult;

    let input: ReleaseResult;

    beforeEach(() => {
      input = {
        releases: [
          { version: '1.0.0' },
          { version: '2.0.0' },
          { version: '2.0.0-alpine' },
          { version: 'v3.0.0-alpine' },
        ],
      };
    });

    it('returns immediately if no versionCompatibility', () => {
      const result = applyVersionCompatibility(input, undefined, undefined);
      expect(result).toBe(input);
    });

    it('filters out non-matching', () => {
      const versionCompatibility = '^(?<version>[^-]+)$';
      expect(
        applyVersionCompatibility(input, versionCompatibility, undefined),
      ).toMatchObject({
        releases: [
          { version: '1.0.0', versionOrig: '1.0.0' },
          { version: '2.0.0', versionOrig: '2.0.0' },
        ],
      });
    });

    it('filters out incompatible', () => {
      const versionCompatibility = '^(?<version>[^-]+)(?<compatibility>.*)?$';
      expect(
        applyVersionCompatibility(input, versionCompatibility, '-alpine'),
      ).toMatchObject({
        releases: [
          { version: '2.0.0', versionOrig: '2.0.0-alpine' },
          { version: 'v3.0.0', versionOrig: 'v3.0.0-alpine' },
        ],
      });
    });

    it('does not override versionOrig from extractVersion', () => {
      const versionCompatibility = '^(?<version>[^-]+)(?<compatibility>.*)?$';
      const res = applyExtractVersion(input, '^v(?<version>.+)$');
      expect(
        applyVersionCompatibility(res, versionCompatibility, '-alpine'),
      ).toMatchObject({
        releases: [{ version: '3.0.0', versionOrig: 'v3.0.0-alpine' }],
      });
    });

    describe('backwards compatibility — no compatibilityVersioning', () => {
      it('preserves exact match behavior so only compatible releases pass', () => {
        const releaseResult: ReleaseResult = {
          releases: [
            { version: '3.12-bookworm' },
            { version: '3.14-bookworm' },
            { version: '3.14-trixie' },
          ],
        };

        const result = applyVersionCompatibility(
          releaseResult,
          '^(?<version>[^-]+)-(?<compatibility>.+)$',
          'bookworm',
        );

        expect(result.releases).toHaveLength(1);
        expect(result.releases[0].versionOrig).toBe('3.14-bookworm');
        expect(
          result.releases.map((release) => release.versionOrig),
        ).not.toContain('3.14-trixie');
      });

      it('handles non-distro suffix compatibility with exact matching', () => {
        const releaseResult: ReleaseResult = {
          releases: [
            { version: '2.0.0-alpine3.18' },
            { version: '2.1.0-alpine3.18' },
            { version: '2.1.0-alpine3.20' },
          ],
        };

        const result = applyVersionCompatibility(
          releaseResult,
          '^(?<version>[^-]+)-(?<compatibility>.+)$',
          'alpine3.18',
        );

        expect(result.releases).toHaveLength(1);
        expect(result.releases[0].versionOrig).toBe('2.1.0-alpine3.18');
      });

      it('keeps version stripping and versionOrig assignment unchanged', () => {
        const releaseResult: ReleaseResult = {
          releases: [
            { version: '3.12.0-bookworm' },
            { version: '3.14.0-bookworm' },
          ],
        };

        const result = applyVersionCompatibility(
          releaseResult,
          '^(?<version>[^-]+)-(?<compatibility>.+)$',
          'bookworm',
        );

        expect(result.releases).toHaveLength(1);
        expect(result.releases[0].version).toBe('3.14.0');
        expect(result.releases[0].versionOrig).toBe('3.14.0-bookworm');
      });

      it('preserves numeric suffix compatibility exact matching', () => {
        const releaseResult: ReleaseResult = {
          releases: [
            { version: 'node:18-buster' },
            { version: 'node:20-buster' },
            { version: 'node:20-bullseye' },
          ],
        };

        const result = applyVersionCompatibility(
          releaseResult,
          '^[^:]+:(?<version>[^-]+)-(?<compatibility>.+)$',
          'buster',
        );

        expect(result.releases).toHaveLength(1);
        expect(result.releases[0].version).toBe('20');
        expect(result.releases[0].versionOrig).toBe('node:20-buster');
      });

      it('falls back to passthrough when versionCompatibility is undefined', () => {
        const releaseResult: ReleaseResult = {
          releases: [
            { version: '1.0' },
            { version: '1.1' },
            { version: '2.0' },
          ],
        };

        const result = applyVersionCompatibility(
          releaseResult,
          undefined,
          undefined,
        );

        expect(result).toBe(releaseResult);
        expect(result.releases).toEqual([
          { version: '1.0' },
          { version: '1.1' },
          { version: '2.0' },
        ]);
      });
    });

    it('allows distro-aware debian compatibility updates', () => {
      const distroInput: ReleaseResult = {
        releases: [
          { version: '3.12-bookworm' },
          { version: '3.14-bookworm' },
          { version: '3.14-trixie' },
        ],
      };
      const versionCompatibility = '^(?<version>[^-]+)-(?<compatibility>.+)$';

      const withoutCompatibilityVersioning = applyVersionCompatibility(
        {
          releases: distroInput.releases.map((release) => ({ ...release })),
        },
        versionCompatibility,
        'bookworm',
      );

      expect(withoutCompatibilityVersioning.releases).toHaveLength(1);
      expect(withoutCompatibilityVersioning.releases[0].versionOrig).toBe(
        '3.14-bookworm',
      );

      const withCompatibilityVersioning =
        applyVersionCompatibilityWithCompatibilityVersioning(
          {
            releases: distroInput.releases.map((release) => ({ ...release })),
          },
          versionCompatibility,
          'bookworm',
          'debian',
        );

      expect(withCompatibilityVersioning.releases).toHaveLength(2);
      expect(
        withCompatibilityVersioning.releases.map(
          (release) => release.versionOrig,
        ),
      ).toEqual(expect.arrayContaining(['3.14-bookworm', '3.14-trixie']));
    });

    it('filters out EOL debian distro candidates', () => {
      const distroInput: ReleaseResult = {
        releases: [{ version: '3.14-bookworm' }, { version: '3.14-buster' }],
      };
      const versionCompatibility = '^(?<version>[^-]+)-(?<compatibility>.+)$';

      const result = applyVersionCompatibilityWithCompatibilityVersioning(
        distroInput,
        versionCompatibility,
        'bullseye',
        'debian',
      );

      expect(result.releases).toHaveLength(1);
      expect(result.releases[0].versionOrig).toBe('3.14-bookworm');
      expect(
        result.releases.map((release) => release.versionOrig),
      ).not.toContain('3.14-buster');
    });

    it('filters out unreleased future debian distro candidates', () => {
      const distroInput: ReleaseResult = {
        releases: [{ version: '3.14-bookworm' }, { version: '3.14-forky' }],
      };
      const versionCompatibility = '^(?<version>[^-]+)-(?<compatibility>.+)$';

      const result = applyVersionCompatibilityWithCompatibilityVersioning(
        distroInput,
        versionCompatibility,
        'bullseye',
        'debian',
      );

      expect(result.releases).toHaveLength(1);
      expect(result.releases[0].versionOrig).toBe('3.14-bookworm');
      expect(
        result.releases.map((release) => release.versionOrig),
      ).not.toContain('3.14-forky');
    });

    it('supports distro-aware ubuntu compatibility updates', () => {
      const distroInput: ReleaseResult = {
        releases: [
          { version: '20-jammy' },
          { version: '22-jammy' },
          { version: '22-noble' },
        ],
      };
      const versionCompatibility = '^(?<version>[^-]+)-(?<compatibility>.+)$';

      const result = applyVersionCompatibilityWithCompatibilityVersioning(
        distroInput,
        versionCompatibility,
        'jammy',
        'ubuntu',
      );

      expect(result.releases).toHaveLength(2);
      expect(result.releases.map((release) => release.versionOrig)).toEqual(
        expect.arrayContaining(['22-jammy', '22-noble']),
      );
    });

    it('supports variant-prefixed distro compatibility updates', () => {
      const distroInput: ReleaseResult = {
        releases: [
          { version: '3.12-slim-bookworm' },
          { version: '3.14-slim-bookworm' },
          { version: '3.14-slim-trixie' },
        ],
      };
      const versionCompatibility = '^(?<version>[^-]+)-(?<compatibility>.+)$';

      const result = applyVersionCompatibilityWithCompatibilityVersioning(
        distroInput,
        versionCompatibility,
        'slim-bookworm',
        'debian',
      );

      expect(result.releases).toHaveLength(2);
      expect(result.releases.map((release) => release.versionOrig)).toEqual(
        expect.arrayContaining(['3.14-slim-bookworm', '3.14-slim-trixie']),
      );
    });

    it('preserves exact matching when compatibilityVersioning is not set', () => {
      const distroInput: ReleaseResult = {
        releases: [
          { version: '3.12-bookworm' },
          { version: '3.14-bookworm' },
          { version: '3.14-trixie' },
        ],
      };
      const versionCompatibility = '^(?<version>[^-]+)-(?<compatibility>.+)$';

      const result = applyVersionCompatibility(
        distroInput,
        versionCompatibility,
        'bookworm',
      );

      expect(result.releases).toHaveLength(1);
      expect(result.releases[0].versionOrig).toBe('3.14-bookworm');
    });

    it('falls back to exact matching for unknown compatibilityVersioning', () => {
      const distroInput: ReleaseResult = {
        releases: [
          { version: '3.12-bookworm' },
          { version: '3.14-bookworm' },
          { version: '3.14-trixie' },
        ],
      };
      const versionCompatibility = '^(?<version>[^-]+)-(?<compatibility>.+)$';

      expect(() =>
        applyVersionCompatibilityWithCompatibilityVersioning(
          distroInput,
          versionCompatibility,
          'bookworm',
          'nonexistent-versioning-scheme',
        ),
      ).not.toThrow();

      const result = applyVersionCompatibilityWithCompatibilityVersioning(
        distroInput,
        versionCompatibility,
        'bookworm',
        'nonexistent-versioning-scheme',
      );

      expect(result.releases).toHaveLength(1);
      expect(result.releases[0].versionOrig).toBe('3.14-bookworm');
    });
  });
});
