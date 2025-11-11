# Release Process

This document outlines the release process for the Scrapar package.

## Versioning Strategy

We follow [Semantic Versioning](https://semver.org/):
- **MAJOR** version for incompatible API changes
- **MINOR** version for backwards-compatible functionality additions
- **PATCH** version for backwards-compatible bug fixes

## Pre-Release Checklist

Before creating a release, ensure:

- [ ] All tests pass (`npm test`)
- [ ] Linting passes (`npm run lint`)
- [ ] Build succeeds (`npm run build`)
- [ ] All TypeScript declarations are generated (`dist/**/*.d.ts` files exist)
- [ ] CLI entry point is built (`dist/cli/index.js` exists)
- [ ] CHANGELOG.md is updated with new version
- [ ] Version in `package.json` is updated
- [ ] README.md is up to date
- [ ] All relevant issues/PRs are closed or linked
- [ ] CI workflow passes on main/master branch

## Build Verification

Verify the distribution build includes all necessary files:

```bash
# Clean and rebuild
npm run clean
npm run build

# Verify structure
ls -R dist/

# Expected structure:
# dist/
#   ├── index.js
#   ├── index.d.ts
#   ├── cli/
#   │   └── index.js
#   ├── core/
#   ├── fetchers/
#   ├── sinks/
#   └── types/
```

Verify `package.json` `files` field includes:
- `dist/` (all compiled files)
- `README.md`
- `LICENSE`

## Publishing Steps

### 1. Prepare Release

```bash
# Ensure you're on the main branch
git checkout master  # or main

# Pull latest changes
git pull origin master

# Run full test suite
npm test

# Build distribution
npm run build

# Verify build outputs
ls -la dist/
```

### 2. Update Version

```bash
# Update version in package.json (manually or use npm version)
npm version patch   # for 0.0.x -> 0.0.x+1
npm version minor   # for 0.x.0 -> 0.x+1.0
npm version major   # for x.0.0 -> x+1.0.0

# This will:
# - Update package.json version
# - Create a git tag
# - Create a git commit
```

Or manually:
1. Edit `package.json` version field
2. Update `CHANGELOG.md` with new version section
3. Commit changes: `git commit -am "chore: bump version to X.Y.Z"`

### 3. Create Git Tag

```bash
# If using npm version, tag is created automatically
# Otherwise, create tag manually:
git tag -a v0.1.0 -m "Release version 0.1.0"
```

### 4. Push to GitHub

```bash
# Push commits and tags
git push origin master
git push origin --tags
```

### 5. Publish to npm

**Important**: Ensure you're logged in to npm and have publish permissions for `@mohssineaboutaj/scraper`.

```bash
# Dry run (verify what will be published)
npm pack --dry-run

# Publish to npm
npm publish --access public

# For scoped packages, --access public is required
```

### 6. Create GitHub Release

1. Go to https://github.com/mohssineAboutaj/scrapar/releases
2. Click "Draft a new release"
3. Select the tag you just created (e.g., `v0.1.0`)
4. Title: `v0.1.0` or `Release v0.1.0`
5. Description: Copy relevant section from `CHANGELOG.md`
6. Mark as "Latest release" if this is the newest version
7. Click "Publish release"

### 7. Post-Release

- [ ] Verify package is available on npm: https://www.npmjs.com/package/@mohssineaboutaj/scraper
- [ ] Verify installation works: `npm install @mohssineaboutaj/scraper`
- [ ] Update any documentation that references version numbers
- [ ] Announce release (if applicable)

## Troubleshooting

### Build Issues

If build fails:
```bash
# Clean and rebuild
npm run clean
rm -rf node_modules package-lock.json
npm install
npm run build
```

### Publishing Issues

If npm publish fails:
- Verify you're logged in: `npm whoami`
- Check package name is available/you have permissions
- Verify `package.json` name matches npm package name
- Check for `.npmignore` that might exclude necessary files

### Missing Type Definitions

If TypeScript declarations are missing:
```bash
# Verify tsconfig.json has declaration: true
# Rebuild
npm run clean
npm run build
# Check dist/ for .d.ts files
find dist -name "*.d.ts"
```

## Rollback

If a release needs to be rolled back:

1. **npm**: Use `npm unpublish` (only within 72 hours of publishing)
   ```bash
   npm unpublish @mohssineaboutaj/scraper@0.1.0
   ```

2. **GitHub**: Delete the release and tag
   - Go to releases page
   - Delete the release
   - Delete the tag: `git push origin :refs/tags/v0.1.0`

3. **Version bump**: Create a new patch version with fixes

## Notes

- Never publish directly from a feature branch
- Always test the built package locally before publishing
- Keep `CHANGELOG.md` updated with each release
- Follow semantic versioning strictly
- Tag releases with `v` prefix (e.g., `v0.1.0`)

