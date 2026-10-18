# Author: David Matura
#
# Engines before 2.1.292 refuse a hooks module that declares the name of a function handed `$` twice, even in another
# scope (docs/development.md). Lists every such name the hooks module declares again: as another function, a variable,
# a destructured name, or a parameter of a function or an arrow. An object's keys are no declaration.
# Usage: python3 dollar-names.py <plugin>/hooks/register.tsx
import re, sys

text = open(sys.argv[1]).read()
handed = set(re.findall(r"function\s+(\w+)\s*(?:<[^>]*>)?\(\s*\$\s*:", text))


def names_in(params):
    # `a: T, { b, c }: U, d = 1` -> a, b, c, d; types and defaults dropped.
    names = []
    for part in re.split(r",(?![^{]*\})", params):
        part = part.strip()
        if part.startswith("{"):
            names += re.findall(r"(\w+)\s*(?:[,}]|$)", part[1 : part.find("}")])
        elif part:
            names.append(re.split(r"[:=?\s]", part, maxsplit=1)[0])
    return names


declared = re.findall(r"\bfunction\s+(\w+)", text)
declared += re.findall(r"\b(?:const|let|var)\s+(\w+)", text)
for group in re.findall(r"\b(?:const|let|var)\s*\{([^}]*)\}\s*=", text):
    declared += re.findall(r"(?:^|,)\s*(?:\w+\s*:\s*)?(\w+)", group)
for params in re.findall(r"\bfunction\s+\w+\s*(?:<[^>]*>)?\(([^)]*)\)", text, re.S):
    declared += names_in(params)
for params in re.findall(r"\(([^()]*)\)\s*(?::\s*[^=;{]+)?=>", text):
    declared += names_in(params)
for single in re.findall(r"(?<![\w.])(\w+)\s*=>", text):
    declared.append(single)

clashes = sorted(f"{name} x{declared.count(name)}" for name in handed if declared.count(name) > 1)
print(f"{len(handed)} functions handed $; " + ("no name declared again" if not clashes else "declared again: " + ", ".join(clashes)))
