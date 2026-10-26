#!/usr/bin/env python3
"""Sitemap coverage for every published blog post."""

from pathlib import Path
import sys
import tempfile
import unittest
import xml.etree.ElementTree as ET

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))

from sync_published_data import (  # noqa: E402
    CANONICAL_PAGES,
    blog_post_date,
    discover_blog_posts,
    write_sitemap,
)

SITEMAP_NS = {"sm": "http://www.sitemaps.org/schemas/sitemap/0.9"}


def sitemap_entries(path: Path) -> dict[str, str]:
    document = ET.parse(path)
    entries = {}
    for url in document.findall("sm:url", SITEMAP_NS):
        loc = url.findtext("sm:loc", default="", namespaces=SITEMAP_NS)
        lastmod = url.findtext("sm:lastmod", default="", namespaces=SITEMAP_NS)
        entries[loc] = lastmod
    return entries


class SitemapTests(unittest.TestCase):
    def test_every_blog_directory_is_listed(self):
        entries = sitemap_entries(ROOT / "sitemap.xml")
        missing = []
        for index in sorted((ROOT / "blog").glob("*/index.html")):
            loc = f"https://diveproca.com/blog/{index.parent.name}/"
            if loc not in entries:
                missing.append(loc)
                continue
            if index.parent.name.startswith("la-jolla-visibility-"):
                published = blog_post_date(index.parent.name, index.read_text(encoding="utf-8"))
                self.assertEqual(entries[loc], published, loc)
        self.assertEqual(missing, [])

    def test_canonical_pages_stay_listed(self):
        entries = sitemap_entries(ROOT / "sitemap.xml")
        for _, url_path in CANONICAL_PAGES:
            self.assertIn(f"https://diveproca.com{url_path}", entries)

    def test_blog_post_date_uses_slug_when_metadata_is_missing(self):
        self.assertEqual(blog_post_date("la-jolla-visibility-18-oct-2026", "<html></html>"), "2026-10-18")
        self.assertEqual(
            blog_post_date("note", '<meta property="article:published_time" content="2026-08-27">'),
            "2026-08-27",
        )

    def test_write_sitemap_keeps_canonical_pages_and_adds_blog_posts(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            for relative, _ in CANONICAL_PAGES:
                path = root / relative
                path.parent.mkdir(parents=True, exist_ok=True)
                path.write_text("<html></html>", encoding="utf-8")
            post = root / "blog" / "la-jolla-visibility-18-oct-2026" / "index.html"
            post.parent.mkdir(parents=True)
            post.write_text(
                '<meta property="article:published_time" content="2026-10-18">',
                encoding="utf-8",
            )
            write_sitemap(root)
            xml = (root / "sitemap.xml").read_text(encoding="utf-8")
            entries = sitemap_entries(root / "sitemap.xml")
            self.assertEqual(
                entries["https://diveproca.com/blog/la-jolla-visibility-18-oct-2026/"],
                "2026-10-18",
            )
            self.assertEqual(xml.count("https://diveproca.com/blog/la-jolla-visibility-18-oct-2026/"), 1)
            self.assertEqual(xml.count("https://diveproca.com/blog/noaa-el-nino-weekly-24-aug-2026/"), 1)
            for _, url_path in CANONICAL_PAGES:
                self.assertIn(f"https://diveproca.com{url_path}", entries)
            blog_index = xml.index("https://diveproca.com/blog/</loc>")
            daily = xml.index("https://diveproca.com/blog/la-jolla-visibility-18-oct-2026/")
            noaa = xml.index("https://diveproca.com/blog/noaa-el-nino-weekly-24-aug-2026/")
            self.assertLess(blog_index, daily)
            self.assertLess(daily, noaa)


if __name__ == "__main__":
    raise SystemExit(unittest.main())
