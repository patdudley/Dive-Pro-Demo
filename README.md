# DiveProCA production website

This repository is the production GitHub Pages site served at <https://diveproca.com/>.

## Repository role

- **Production web frontend:** this repository
- **Forecast/model source:** [patdudley/DivePro](https://github.com/patdudley/DivePro) (private)
- **Legacy DiveProSD public export and camera source:** [patdudley/DivePro-site](https://github.com/patdudley/DivePro-site)

The root `CNAME` file binds this repository to `diveproca.com`. Changes pushed to
`main` can therefore affect the live site.

The `Sync Scripps camera` workflow copies the current Scripps camera pointers and
referenced images from `DivePro-site` into this production repository. Do not describe
this repository as a preview or demo while it owns the production domain.
