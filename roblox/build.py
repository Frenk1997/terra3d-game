#!/usr/bin/env python3
"""Собирает Roblox-место Terra 3D из исходников roblox/src в один файл TerraRoblox.rbxlx.

    python3 roblox/build.py            → roblox/TerraRoblox.rbxlx (открыть в Roblox Studio)

Заодно пишет roblox/sourcemap.json — карту «объект Roblox → файл» для проверки кода (luau-lsp).
Rojo не нужен: формат .rbxlx — обычный XML, Studio открывает его как любое место.
"""
import json
import os
from xml.sax.saxutils import escape

ROOT = os.path.dirname(os.path.abspath(__file__))

# дерево места: (класс, имя, файл исходника или None, свойства, дети)
TREE = [
    ("Players", "Players", None, {"CharacterAutoLoads": ("bool", "false")}, []),
    ("ReplicatedStorage", "ReplicatedStorage", None, {}, [
        ("ModuleScript", "TerraShared", "src/shared/TerraShared.lua", {}, []),
    ]),
    ("ServerScriptService", "ServerScriptService", None, {}, [
        ("Script", "TerraServer", "src/server/TerraServer.server.lua", {}, []),
        ("ModuleScript", "PlanetBuilder", "src/server/PlanetBuilder.lua", {}, []),
    ]),
    ("StarterPlayer", "StarterPlayer", None, {}, [
        ("StarterPlayerScripts", "StarterPlayerScripts", None, {}, [
            ("LocalScript", "TerraClient", "src/client/TerraClient.client.lua", {}, []),
        ]),
    ]),
]

_ref = [0]


def item(node, out, depth):
    cls, name, src, props, children = node
    _ref[0] += 1
    pad = "\t" * depth
    out.append(f'{pad}<Item class="{cls}" referent="RBX{_ref[0]:08X}">')
    out.append(f"{pad}\t<Properties>")
    out.append(f'{pad}\t\t<string name="Name">{escape(name)}</string>')
    for k, (typ, val) in props.items():
        out.append(f'{pad}\t\t<{typ} name="{k}">{escape(val)}</{typ}>')
    if src:
        code = open(os.path.join(ROOT, src), encoding="utf-8").read()
        if "]]>" in code:
            raise SystemExit(f"{src}: в коде не должно быть ']]>'")
        out.append(f'{pad}\t\t<ProtectedString name="Source"><![CDATA[{code}]]></ProtectedString>')
    out.append(f"{pad}\t</Properties>")
    for ch in children:
        item(ch, out, depth + 1)
    out.append(f"{pad}</Item>")


def sourcemap(node):
    cls, name, src, _, children = node
    d = {"name": name, "className": cls}
    if src:
        d["filePaths"] = [src]
    if children:
        d["children"] = [sourcemap(c) for c in children]
    return d


def main():
    out = ['<roblox xmlns:xmime="http://www.w3.org/2005/05/xmlmime" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" '
           'xsi:noNamespaceSchemaLocation="http://www.roblox.com/roblox.xsd" version="4">',
           "\t<External>null</External>", "\t<External>nil</External>"]
    for node in TREE:
        item(node, out, 1)
    out.append("</roblox>")
    path = os.path.join(ROOT, "TerraRoblox.rbxlx")
    with open(path, "w", encoding="utf-8", newline="\n") as f:
        f.write("\n".join(out) + "\n")
    sm = {"name": "Terra 3D", "className": "DataModel", "children": [sourcemap(n) for n in TREE]}
    with open(os.path.join(ROOT, "sourcemap.json"), "w", encoding="utf-8") as f:
        json.dump(sm, f, ensure_ascii=False, indent=1)
    # исходники для дымовой проверки без Studio (tests/smoke_test.luau)
    srcs = {}

    def collect(node):
        cls, name, src, _, children = node
        if src:
            srcs[name] = open(os.path.join(ROOT, src), encoding="utf-8").read()
        for c in children:
            collect(c)
    for n in TREE:
        collect(n)
    lines = ["-- создан build.py: исходники скриптов для tests/smoke_test.luau", "return {"]
    for name, code in srcs.items():
        if "]=====]" in code:
            raise SystemExit(f"{name}: в коде не должно быть ']=====]'")
        lines.append(f"\t{name} = [=====[{code}]=====],")
    lines.append("}")
    with open(os.path.join(ROOT, "tests", "_sources.luau"), "w", encoding="utf-8", newline="\n") as f:
        f.write("\n".join(lines) + "\n")
    print(f"Готово: {path} ({os.path.getsize(path) // 1024} КБ)")


if __name__ == "__main__":
    main()
