import {
  isNonEmptyArray,
  isNonEmptyStringAndNotWhitespace,
} from '@sindresorhus/is';
import { logger } from '../../logger/index.ts';
import { filterMap } from '../../util/filter-map.ts';
import { regEx } from '../../util/regex.ts';
import { DistroInfo } from '../versioning/distro.ts';
import * as allVersioning from '../versioning/index.ts';
import { defaultVersioning } from '../versioning/index.ts';
import type { VersioningApi } from '../versioning/types.ts';
import datasources from './api.ts';
import { CustomDatasource } from './custom/index.ts';
import type {
  DatasourceApi,
  GetPkgReleasesConfig,
  ReleaseResult,
} from './types.ts';

export function getDatasourceFor(datasource: string): DatasourceApi | null {
  if (datasource?.startsWith('custom.')) {
    return getDatasourceFor(CustomDatasource.id);
  }
  return datasources.get(datasource) ?? null;
}

export function getDefaultVersioning(
  datasourceName: string | undefined,
): string {
  if (!datasourceName) {
    return defaultVersioning.id;
  }

  const datasource = getDatasourceFor(datasourceName);

  if (!datasource) {
    logger.warn({ datasourceName }, 'Missing datasource!');
    return defaultVersioning.id;
  }

  if (!datasource.defaultVersioning) {
    return defaultVersioning.id;
  }

  return datasource.defaultVersioning;
}

export function isGetPkgReleasesConfig(
  input: unknown,
): input is GetPkgReleasesConfig {
  return (
    isNonEmptyStringAndNotWhitespace(
      (input as GetPkgReleasesConfig).datasource,
    ) &&
    isNonEmptyStringAndNotWhitespace(
      (input as GetPkgReleasesConfig).packageName,
    )
  );
}

export function applyVersionCompatibility(
  releaseResult: ReleaseResult,
  versionCompatibility: string | undefined,
  currentCompatibility: string | undefined,
  compatibilityVersioning?: string,
): ReleaseResult {
  if (!versionCompatibility) {
    return releaseResult;
  }

  const exactMatchOnly = (
    releaseCompatibility: string | undefined,
  ): boolean => {
    if (releaseCompatibility !== currentCompatibility) {
      logger.trace(
        { releaseCompatibility, versionCompatibility },
        'versionCompatibility: Does not match compatibility',
      );
      return false;
    }
    return true;
  };

  let compatibilityVersioningApi: VersioningApi | null = null;
  let releaseDistroInfo: DistroInfo | null = null;
  if (compatibilityVersioning) {
    try {
      compatibilityVersioningApi = allVersioning.get(compatibilityVersioning);
      if (compatibilityVersioning === 'debian') {
        releaseDistroInfo = new DistroInfo('data/debian-distro-info.json');
      } else if (compatibilityVersioning === 'ubuntu') {
        releaseDistroInfo = new DistroInfo('data/ubuntu-distro-info.json');
      }
    } catch (err) {
      logger.debug(
        { err, compatibilityVersioning },
        'versionCompatibility: Unknown compatibilityVersioning - fallback to exact matching',
      );
    }
  }

  const currentCompatibilityParts =
    compatibilityVersioningApi && currentCompatibility
      ? parseCompatibilityString(
          currentCompatibility,
          compatibilityVersioningApi,
        )
      : null;

  const versionCompatibilityRegEx = regEx(versionCompatibility);
  const shouldFilterToLatestCompatibleVersion =
    isNonEmptyStringAndNotWhitespace(currentCompatibility) &&
    !currentCompatibility.startsWith('-');

  let latestCompatibleVersion: string | null = null;
  if (shouldFilterToLatestCompatibleVersion) {
    const versioningApi = allVersioning.get(defaultVersioning.id);
    for (const release of releaseResult.releases) {
      const sourceVersion = release.version;
      const regexResult = versionCompatibilityRegEx.exec(sourceVersion);
      if (!regexResult?.groups?.version) {
        continue;
      }
      if (compatibilityVersioningApi && releaseDistroInfo) {
        const parsed = parseCompatibilityString(
          regexResult.groups.compatibility,
          compatibilityVersioningApi,
        );
        if (parsed) {
          const { distroCodename } = parsed;
          const isStable =
            releaseDistroInfo.isCodename(distroCodename) &&
            releaseDistroInfo.isReleased(distroCodename) &&
            !releaseDistroInfo.isEolLts(distroCodename);
          if (!isStable) {
            continue;
          }
        } else {
          continue;
        }
      } else if (regexResult.groups.compatibility !== currentCompatibility) {
        continue;
      }
      if (
        latestCompatibleVersion === null ||
        versioningApi.sortVersions(
          regexResult.groups.version,
          latestCompatibleVersion,
        ) > 0
      ) {
        latestCompatibleVersion = regexResult.groups.version;
      }
    }
  }

  releaseResult.releases = filterMap(releaseResult.releases, (release) => {
    const regexResult =
      versionCompatibilityRegEx.exec(release.version) ??
      (release.versionOrig
        ? versionCompatibilityRegEx.exec(release.versionOrig)
        : null);
    if (!regexResult?.groups?.version) {
      logger.trace(
        { releaseVersion: release.version, versionCompatibility },
        'versionCompatibility: Does not match regex',
      );
      return null;
    }

    if (
      latestCompatibleVersion !== null &&
      regexResult.groups.version !== latestCompatibleVersion
    ) {
      logger.trace(
        {
          releaseVersion: release.version,
          versionCompatibility,
          latestCompatibleVersion,
          version: regexResult.groups.version,
        },
        'versionCompatibility: Does not match latest compatible version',
      );
      return null;
    }

    const releaseCompatibility = regexResult.groups.compatibility;
    if (!compatibilityVersioningApi) {
      if (!exactMatchOnly(releaseCompatibility)) {
        return null;
      }
    } else if (releaseCompatibility !== currentCompatibility) {
      const releaseCompatibilityParts = parseCompatibilityString(
        releaseCompatibility,
        compatibilityVersioningApi,
      );
      if (!releaseCompatibilityParts) {
        logger.trace(
          { releaseVersion: release.version, releaseCompatibility },
          'versionCompatibility: No distro codename found in compatibility',
        );
        return null;
      }

      if (
        currentCompatibilityParts &&
        releaseCompatibilityParts.variant !== currentCompatibilityParts.variant
      ) {
        logger.trace(
          {
            releaseVersion: release.version,
            releaseVariant: releaseCompatibilityParts.variant,
            currentVariant: currentCompatibilityParts.variant,
          },
          'versionCompatibility: Variant mismatch',
        );
        return null;
      }

      const isStable = releaseDistroInfo
        ? releaseDistroInfo.isCodename(
            releaseCompatibilityParts.distroCodename,
          ) &&
          releaseDistroInfo.isReleased(
            releaseCompatibilityParts.distroCodename,
          ) &&
          !releaseDistroInfo.isEolLts(releaseCompatibilityParts.distroCodename)
        : compatibilityVersioningApi.isStable(
            releaseCompatibilityParts.distroCodename,
          );

      if (!isStable) {
        logger.trace(
          {
            releaseVersion: release.version,
            releaseCompatibility,
            distroCodename: releaseCompatibilityParts.distroCodename,
          },
          'versionCompatibility: Distro compatibility is not stable/active',
        );
        return null;
      }
    } else if (!exactMatchOnly(releaseCompatibility)) {
      return null;
    }

    logger.trace(
      {
        releaseVersion: release.version,
        versionCompatibility,
        version: regexResult.groups.version,
        compatibility: regexResult.groups.compatibility,
      },
      'versionCompatibility: matches',
    );
    release.versionOrig ??= release.version;
    release.version = regexResult.groups.version;
    return release;
  });

  if (compatibilityVersioningApi) {
    const compatibilityVariantsByVersion = new Map<string, Set<string>>();

    for (const release of releaseResult.releases) {
      const sourceValue = release.versionOrig ?? release.version;
      const compatibility =
        versionCompatibilityRegEx.exec(sourceValue)?.groups?.compatibility;

      if (!isNonEmptyStringAndNotWhitespace(compatibility)) {
        continue;
      }

      const existingCompatibilities = compatibilityVariantsByVersion.get(
        release.version,
      );
      if (existingCompatibilities) {
        existingCompatibilities.add(compatibility);
      } else {
        compatibilityVariantsByVersion.set(
          release.version,
          new Set([compatibility]),
        );
      }
    }

    for (const release of releaseResult.releases) {
      const compatibilityVariants = compatibilityVariantsByVersion.get(
        release.version,
      );
      if (!compatibilityVariants?.size) {
        delete release.compatibilityVariants;
        continue;
      }
      release.compatibilityVariants = [...compatibilityVariants];
    }
  }

  return releaseResult;
}

function parseCompatibilityString(
  compatibility: string,
  versioning: VersioningApi,
): { variant: string; distroCodename: string } | null {
  const parts = compatibility
    .split('-')
    .filter(isNonEmptyStringAndNotWhitespace);

  for (const [index, part] of parts.entries()) {
    if (!versioning.isVersion(part)) {
      continue;
    }

    const variantParts = parts.slice(0, index);
    return {
      variant: variantParts.length > 0 ? `${variantParts.join('-')}-` : '',
      distroCodename: part,
    };
  }

  return null;
}

export function applyExtractVersion(
  releaseResult: ReleaseResult,
  extractVersion: string | undefined,
): ReleaseResult {
  if (!extractVersion) {
    return releaseResult;
  }

  const extractVersionRegEx = regEx(extractVersion);
  releaseResult.releases = filterMap(releaseResult.releases, (release) => {
    const version = extractVersionRegEx.exec(release.version)?.groups?.version;
    if (!version) {
      return null;
    }

    release.versionOrig = release.version;
    release.version = version;
    return release;
  });

  return releaseResult;
}

export function filterValidVersions<
  Config extends Pick<GetPkgReleasesConfig, 'versioning' | 'datasource'>,
>(releaseResult: ReleaseResult, config: Config): ReleaseResult {
  const versioningName =
    config.versioning ?? getDefaultVersioning(config.datasource);
  const versioning = allVersioning.get(versioningName);

  releaseResult.releases = filterMap(releaseResult.releases, (release) =>
    versioning.isVersion(release.version) ? release : null,
  );

  return releaseResult;
}

export function sortAndRemoveDuplicates<
  Config extends Pick<GetPkgReleasesConfig, 'versioning' | 'datasource'>,
>(releaseResult: ReleaseResult, config: Config): ReleaseResult {
  const versioningName =
    config.versioning ?? getDefaultVersioning(config.datasource);
  const versioning = allVersioning.get(versioningName);

  releaseResult.releases = releaseResult.releases.sort((a, b) =>
    versioning.sortVersions(a.version, b.version),
  );

  // Once releases are sorted, deduplication is straightforward and efficient
  let previousVersion: string | null = null;
  releaseResult.releases = filterMap(releaseResult.releases, (release) => {
    if (previousVersion === release.version) {
      return null;
    }
    previousVersion = release.version;
    return release;
  });

  return releaseResult;
}

export function applyConstraintsFiltering<
  Config extends Pick<
    GetPkgReleasesConfig,
    | 'constraintsFiltering'
    | 'versioning'
    | 'datasource'
    | 'constraints'
    | 'packageName'
  >,
>(releaseResult: ReleaseResult, config: Config): ReleaseResult {
  if (config?.constraintsFiltering !== 'strict') {
    for (const release of releaseResult.releases) {
      delete release.constraints;
    }

    return releaseResult;
  }

  const versioningName =
    config.versioning ?? getDefaultVersioning(config.datasource);
  const versioning = allVersioning.get(versioningName);

  const configConstraints = config.constraints;
  const filteredReleases: string[] = [];
  const startingLength = releaseResult.releases.length;
  releaseResult.releases = filterMap(releaseResult.releases, (release) => {
    const releaseConstraints = release.constraints;
    delete release.constraints;

    if (!configConstraints || !releaseConstraints) {
      return release;
    }

    for (const [name, configConstraint] of Object.entries(configConstraints)) {
      if (!versioning.isValid(configConstraint)) {
        logger.once.warn(
          {
            packageName: config.packageName,
            constraint: configConstraint,
            versioning: versioningName,
          },
          'Invalid constraint used with strict constraintsFiltering',
        );
        continue;
      }

      const constraint = releaseConstraints[name];
      if (!isNonEmptyArray(constraint)) {
        // A release with no constraints is OK
        continue;
      }

      let satisfiesConstraints = false;
      for (const releaseConstraint of constraint) {
        if (!releaseConstraint) {
          satisfiesConstraints = true;
          logger.once.debug(
            {
              packageName: config.packageName,
              versioning: versioningName,
              constraint: releaseConstraint,
            },
            'Undefined release constraint',
          );
          break;
        }

        if (!versioning.isValid(releaseConstraint)) {
          logger.once.debug(
            {
              packageName: config.packageName,
              versioning: versioningName,
              constraint: releaseConstraint,
            },
            'Invalid release constraint',
          );
          break;
        }

        if (configConstraint === releaseConstraint) {
          satisfiesConstraints = true;
          break;
        }

        if (versioning.subset?.(configConstraint, releaseConstraint)) {
          satisfiesConstraints = true;
          break;
        }

        if (versioning.matches(configConstraint, releaseConstraint)) {
          satisfiesConstraints = true;
          break;
        }
      }

      if (!satisfiesConstraints) {
        filteredReleases.push(release.version);
        return null;
      }
    }

    return release;
  });

  if (filteredReleases.length) {
    const count = filteredReleases.length;
    const packageName = config.packageName;
    const releases = filteredReleases.join(', ');
    logger.debug(
      `Filtered out ${count} non-matching releases out of ${startingLength} total for ${packageName} due to constraintsFiltering=strict: ${releases}`,
    );
  }

  return releaseResult;
}
