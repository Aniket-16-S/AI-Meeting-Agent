import io
import PyPDF2

def parse_txt(content: bytes) -> str:
    return content.decode("utf-8", errors="ignore")

def parse_vtt(content: bytes) -> str:
    text = content.decode("utf-8", errors="ignore")
    lines = text.split('\n')
    cleaned_lines = []
    for line in lines:
        line = line.strip()
        if not line:
            continue
        if '-->' in line:
            continue
        if line.upper() == 'WEBVTT':
            continue
        if line.isdigit():
            continue
        cleaned_lines.append(line)
    return "\n".join(cleaned_lines)

def parse_pdf(content: bytes) -> str:
    pdf_reader = PyPDF2.PdfReader(io.BytesIO(content))
    text = ""
    for page in pdf_reader.pages:
        page_text = page.extract_text()
        if page_text:
            text += page_text + "\n"
    return text

def extract_text(filename: str, content: bytes) -> str:
    if not filename:
        raise ValueError("Filename is required to determine format")
    ext = filename.lower().split('.')[-1]
    if ext == "txt":
        return parse_txt(content)
    elif ext == "vtt":
        return parse_vtt(content)
    elif ext == "pdf":
        return parse_pdf(content)
    else:
        raise ValueError(f"Unsupported file format: {ext}")