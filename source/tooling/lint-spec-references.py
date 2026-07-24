import sys
import re

def main():
    if len(sys.argv) < 2:
        print("Uso: python lint-spec-references.py <archivo.md>")
        sys.exit(1)

    file_path = sys.argv[1]
    
    with open(file_path, 'r', encoding='utf-8') as f:
        content = f.read()

    # Encontrar todas las definiciones de IDs
    # Pueden estar en tablas o en texto `ID-001`
    defined_ids = set()
    definitions = re.findall(r'`([A-Z]+-[A-Z]+-[0-9]+)`', content)
    defined_ids.update(definitions)
    
    # También capturar WU-XX
    wu_defs = re.findall(r'`(WU-[0-9]{2})`', content)
    defined_ids.update(wu_defs)

    # Identificar referencias
    references = set()
    refs = re.findall(r'`([A-Z]+-[A-Z]+-[0-9]+)`', content)
    references.update(refs)
    
    wu_refs = re.findall(r'`(WU-[0-9]{2})`', content)
    references.update(wu_refs)

    # Revisar IDs indefinidos
    undefined = references - defined_ids
    if undefined:
        print("Error: Referencias a IDs no definidos encontradas:")
        for uid in undefined:
            print(f" - {uid}")
        sys.exit(1)
        
    print("Lint de referencias completado con éxito.")
    sys.exit(0)

if __name__ == "__main__":
    main()
