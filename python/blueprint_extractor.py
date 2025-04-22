import json
import os
import sys
import tempfile

from plasTeX.Compile import parse
from plasTeX.Config import defaultConfig
from plasTeX.DOM import Node


def extract_label(node):
    if node.nodeName == "label":
        return node.attributes["label"]
    if node.hasChildNodes:
        for subnode in node.childNodes:
            label = extract_label(subnode)
            if label:
                return label


def extract_text(node):
    text = (
        "".join(
            [
                subsubnode.source
                for subnode in node.childNodes
                for subsubnode in subnode.childNodes
                if subsubnode.nodeName not in ["label", "leanok", "uses", "lean"]
            ]
        )
    ).strip()
    return text.strip()


def extract_uses(node):
    res = {}
    # Extract labels in "uses"
    if "uses" in node.userdata:
        res["uses"] = [extract_label(subnode) for subnode in node.userdata["uses"]]
    return res


def rec_extract_dep_graph_info(node: Node) -> list[dict]:  # type: ignore
    if node.nodeName == "thmenv":
        attributes: dict = {
            "stmt_type": node.thmName,  # type: ignore
            "label": extract_label(node),
            "processed_text": extract_text(node),
            "raw_text": node.source,  # type: ignore
        }

        if "title" in node.attributes and node.attributes["title"]:  # type: ignore
            attributes["title"] = node.attributes["title"].source  # type: ignore

        if node.userdata:
            attributes |= node.userdata
            attributes.pop("lean_urls", None)
            attributes.update(extract_uses(node))

            # Extract proof
            if "proved_by" in attributes:
                attributes["proof"] = {
                    "text": extract_text(attributes["proved_by"]),
                    "source": attributes["proved_by"].source,
                } | attributes["proved_by"].userdata
                attributes["proof"].pop("proves")
                attributes["proof"].update(extract_uses(attributes["proved_by"]))
                attributes.pop("proved_by")

        return [attributes]

    if node.hasChildNodes:
        res = []
        for subnode in node.childNodes:
            res.extend(rec_extract_dep_graph_info(subnode))
        return res


def find_file(root: str, filename: str) -> str | None:
    for dirpath, _, files in os.walk(root):
        if filename in files:
            return os.path.join(dirpath, filename)


def extract_blueprint_info(blueprint_src_path: str, verbose: bool = False) -> list[dict]:
    # find the webtex file in the blueprint source path
    webtex_file = find_file(blueprint_src_path, "web.tex")
    if not webtex_file:
        raise FileNotFoundError("web.tex file not found in the blueprint source path")

    print(f"Extracting blueprint information from {webtex_file}", file=sys.stderr)

    os.chdir(os.path.dirname(webtex_file))

    config = defaultConfig()
    plastex_file = find_file(blueprint_src_path, "plastex.cfg")
    if plastex_file:
        config.read(plastex_file)
    else:
        print("No plastex.cfg file found in the blueprint source path", file=sys.stderr)

    if not verbose:
        config["files"]["log"] = True

    tex = parse(webtex_file, config=config)
    doc = tex.ownerDocument

    blueprint_extracted = rec_extract_dep_graph_info(doc)

    return blueprint_extracted


if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("Usage: python blueprint_extractor.py <blueprint_src_path> [output_json_path]", file=sys.stderr)
        sys.exit(1)
    blueprint_src_path = sys.argv[1]
    output_json_path = sys.argv[2] if len(sys.argv) > 2 else None
    try:
        result = extract_blueprint_info(blueprint_src_path)
        json_str = json.dumps(result, ensure_ascii=False)
        if output_json_path:
            with open(output_json_path, "w", encoding="utf-8") as f:
                f.write(json_str)
        else:
            print(json_str)
    except Exception as e:
        print(f"Error: {e}", file=sys.stderr)
        sys.exit(1)
