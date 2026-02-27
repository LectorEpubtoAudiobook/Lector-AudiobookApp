import ebooklib, re, base64
from ebooklib import epub
from bs4 import BeautifulSoup

# Titles that indicate boilerplate pages to skip
SKIP_TITLE_PATTERNS = re.compile(
    r'^\s*(table\s+of\s+contents?|contents?|copyright|cover|title\s+page|'
    r'dedication|epigraph|foreword|preface|acknowledgements?|acknowledgments?|'
    r'about\s+the\s+(author|publisher|book)|also\s+by|praise\s+for|'
    r'half\s+title|front\s+matter|index|bibliography|glossary|notes?|'
    r'by\s+the\s+same|permissions?|credits?|colophon|legal|disclaimer)\s*$',
    re.IGNORECASE
)

# Text patterns that indicate a boilerplate page
SKIP_TEXT_PATTERNS = re.compile(
    r'(all\s+rights\s+reserved|copyright\s+©|first\s+published|'
    r'isbn\s*[\d\-]{10,}|printed\s+in\s+the|no\s+part\s+of\s+this\s+publication|'
    r'library\s+of\s+congress|published\s+by\s+\w+\s+(press|publishing|books)|'
    r'for\s+permissions|cataloging.in.publication)',
    re.IGNORECASE
)

def clean_text(html: str) -> str:
    soup = BeautifulSoup(html, "lxml")
    for tag in soup(["script", "style", "img"]):
        tag.decompose()
    text = soup.get_text(separator=" ")
    return re.sub(r'\s+', ' ', text).strip()

def extract_cover(book) -> str | None:
    """Return base64 data-URI for the cover image, or None."""
    cover_id = None
    for name, val in book.get_metadata("OPF", "cover") or []:
        cover_id = val.get("content")
        break

    if cover_id:
        item = book.get_item_with_id(cover_id)
        if item:
            mt = item.media_type or "image/jpeg"
            return f"data:{mt};base64,{base64.b64encode(item.get_content()).decode()}"

    for item in book.get_items_of_type(ebooklib.ITEM_IMAGE):
        name = (item.get_name() or "").lower()
        if "cover" in name:
            mt = item.media_type or "image/jpeg"
            return f"data:{mt};base64,{base64.b64encode(item.get_content()).decode()}"

    for item in book.get_items_of_type(ebooklib.ITEM_IMAGE):
        mt = item.media_type or "image/jpeg"
        return f"data:{mt};base64,{base64.b64encode(item.get_content()).decode()}"

    return None

def is_boilerplate(title: str, text: str) -> bool:
    """Return True if this page should be skipped."""
    # Skip by title match
    if SKIP_TITLE_PATTERNS.match(title.strip()):
        return True
    # Skip if text is very short (likely a title/cover page)
    if len(text) < 150:
        return True
    # Skip if text contains copyright/legal boilerplate
    if SKIP_TEXT_PATTERNS.search(text[:500]):
        return True
    # Skip if text is mostly a list of short lines (table of contents)
    lines = [l.strip() for l in text.splitlines() if l.strip()]
    if len(lines) > 5:
        avg_line_len = sum(len(l) for l in lines) / len(lines)
        if avg_line_len < 40 and len(lines) > 10:
            return True
    return False

def get_chapter_title(soup, fallback: str) -> str:
    """Extract the best chapter title from the HTML."""
    for tag in ["h1", "h2", "h3"]:
        heading = soup.find(tag)
        if heading:
            t = heading.get_text(strip=True)
            if t and len(t) < 120:
                return t
    return fallback

def parse_epub(path: str) -> dict:
    book = epub.read_epub(path)

    title  = book.get_metadata("DC", "title")
    title  = title[0][0] if title else "Unknown Title"
    author = book.get_metadata("DC", "creator")
    author = author[0][0] if author else "Unknown Author"
    desc   = book.get_metadata("DC", "description")
    description = clean_text(desc[0][0]) if desc else ""

    cover_data_uri = extract_cover(book)

    raw_chapters = []
    for item in book.get_items_of_type(ebooklib.ITEM_DOCUMENT):
        content  = item.get_content().decode("utf-8", errors="ignore")
        soup     = BeautifulSoup(content, "lxml")
        text     = clean_text(content)
        ch_title = get_chapter_title(soup, f"Chapter {len(raw_chapters) + 1}")

        if is_boilerplate(ch_title, text):
            continue

        raw_chapters.append({"title": ch_title, "text": text})

    # If after filtering we have nothing, fall back to no filtering
    # (better to have boilerplate than an empty book)
    if not raw_chapters:
        for item in book.get_items_of_type(ebooklib.ITEM_DOCUMENT):
            content  = item.get_content().decode("utf-8", errors="ignore")
            soup     = BeautifulSoup(content, "lxml")
            text     = clean_text(content)
            if len(text) < 100:
                continue
            ch_title = get_chapter_title(soup, f"Chapter {len(raw_chapters) + 1}")
            raw_chapters.append({"title": ch_title, "text": text})

    return {
        "title": title,
        "author": author,
        "description": description,
        "cover": cover_data_uri,
        "chapters": raw_chapters
    }