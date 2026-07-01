import hashlib

def generate_file_hash(content: bytes) -> str:
    """Generate SHA-256 hash of the file content."""
    return hashlib.sha256(content).hexdigest()