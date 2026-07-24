import os
import glob
import re

files = glob.glob('source/frontend/src/pages/creador-productos/*.tsx', recursive=True)
for f in files:
    with open(f, 'r') as file:
        content = file.read()
    
    # 1. Update max-w-2xl to max-w-3xl or 4xl in modals to use more space
    content = content.replace('className="max-w-2xl"', 'className="max-w-4xl"')

    # 2. Fix the grid-cols to be responsive
    # grid-cols-2 -> grid-cols-1 md:grid-cols-2 lg:grid-cols-3
    content = re.sub(r'className="grid grid-cols-2 gap-([234])"', r'className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-\1"', content)
    
    # grid-cols-3 -> grid-cols-1 md:grid-cols-3 lg:grid-cols-4
    content = re.sub(r'className="grid grid-cols-3 gap-([234])"', r'className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-4 gap-\1"', content)

    # for small modals (like presentaciones-formatos, etc.) if they got lg:grid-cols-3, it's fine as they will just expand, 
    # but wait, max-w-4xl is 896px. 3 cols is ~280px each.
    
    with open(f, 'w') as file:
        file.write(content)
