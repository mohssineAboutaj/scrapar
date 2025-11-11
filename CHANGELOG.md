# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- Initial release with core scraping framework
- HTML fetcher with Cheerio integration
- API fetcher with authentication support
- Pipeline orchestration with dependency resolution
- Step logging manager for resume/retry flows
- JSON sink for data persistence
- CLI commands: run, resume, retry-failed, status
- Comprehensive TypeScript type definitions
- Unit tests for all core modules
- GitHub Actions CI workflow

## [0.1.0] - 2025-11-11

### Added
- Project scaffolding and tooling setup
- Core type definitions (ScrapeRunner, PipelineStep, ScrapeContext, Fetcher, Sink)
- HTML fetcher implementation with axios and Cheerio
- API fetcher implementation with GET/POST support
- Loop controller for iterative execution
- ScrapeRunner with dependency resolution and lifecycle hooks
- Step logger for persistent state management
- JSON sink for file-based persistence
- CLI tooling with commander.js
- Documentation and example pipelines
- Unit test suite (35 tests)
- CI/CD pipeline with GitHub Actions

[Unreleased]: https://github.com/mohssineAboutaj/scrapar/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/mohssineAboutaj/scrapar/releases/tag/v0.1.0

