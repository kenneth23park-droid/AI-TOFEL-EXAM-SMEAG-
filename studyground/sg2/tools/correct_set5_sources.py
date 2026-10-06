"""Correct verified SET 5 layout and speaker-label errors in repository working copies.

Downloads originals are never edited. Only target paragraph text runs change;
other ZIP entries retain their original bytes. A one-time backup permits rollback.
"""
from pathlib import Path
from zipfile import ZipFile
import shutil
import xml.etree.ElementTree as ET

ROOT = Path(__file__).resolve().parents[3]
W = '{http://schemas.openxmlformats.org/wordprocessingml/2006/main}'

def edit(name, transform):
    target = ROOT / name
    backup = target.with_name(target.name + '.bak-set5-original')
    if not backup.exists():
        shutil.copy2(target, backup)
    with ZipFile(target) as z:
        entries = [(i, z.read(i.filename)) for i in z.infolist()]
    xml = next(data for info, data in entries if info.filename == 'word/document.xml')
    # Preserve original namespace prefixes when serializing.
    import io
    for _, (prefix, uri) in ET.iterparse(io.BytesIO(xml), events=['start-ns']):
        try:
            ET.register_namespace(prefix, uri)
        except ValueError:
            pass
    root = ET.fromstring(xml)
    changed = transform(root)
    if not changed:
        print(name, 'already corrected')
        return
    payload = ET.tostring(root, encoding='utf-8', xml_declaration=True)
    with ZipFile(target, 'w') as z:
        for info, data in entries:
            z.writestr(info, payload if info.filename == 'word/document.xml' else data)
    print(name, changed, 'paragraphs corrected')

def text(p):
    return ''.join(t.text or '' for t in p.iter(W + 't'))

def replace(p, value):
    runs = list(p.iter(W + 't'))
    assert runs
    runs[0].text = value
    runs[0].set('{http://www.w3.org/XML/1998/namespace}space', 'preserve')
    for t in runs[1:]:
        t.text = ''

def questions(root):
    changed = 0
    paras = list(root.iter(W + 'p'))
    targets = {
        'I am planning a trip to Paris next spring.': 'Do ' + ' '.join(['______'] * 7) + '?',
        'How was the documentary you watched last night?': 'It ' + ' '.join(['______'] * 10) + '.',
        'The instructions for this software are really confusing.': '______ ______ figured out ______ ______ ______ ______ yet?',
    }
    for i, p in enumerate(paras):
        desired = targets.get(text(p).strip())
        if desired and text(paras[i + 1]) != desired:
            replace(paras[i + 1], desired)
            changed += 1
        if text(p).strip() == 'The instructions for this software are really confusing.':
            tiles = paras[i + 2]
            current = text(tiles)
            if not any(t.strip() == 'to' for t in current.split('    ')):
                replace(tiles, current.rstrip() + '    to')
                changed += 1
    return changed

def script(root):
    changed = 0
    active = False
    paras = list(root.iter(W + 'p'))
    # Idempotence: the student must be Man and the professor Woman.
    already = any(text(p).startswith('Man: Professor Adams, I wanted') for p in paras)
    if already:
        return 0
    for p in paras:
        value = text(p)
        if value.strip() == 'Question 4-5':
            active = True
            continue
        if active and value.strip() == 'Question 6-7':
            break
        if active and value.startswith(('Woman:', 'Man:')):
            speaker, dialogue = value.split(':', 1)
            replace(p, ('Man' if speaker == 'Woman' else 'Woman') + ':' + dialogue)
            changed += 1
    assert changed == 5
    return changed

if __name__ == '__main__':
    edit('NEW TOEFL SET 5 1.docx', questions)
    edit('Set 5 Script 1.docx', script)
