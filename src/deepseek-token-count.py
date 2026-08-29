"""Thin, offline use of the frozen official renderer. Never print the rendered prompt."""
import importlib.util
import json
from pathlib import Path
import sys

sys.dont_write_bytecode = True


def main():
    from tokenizers import Tokenizer

    data = json.load(sys.stdin)
    root = Path(data["root"])
    spec = importlib.util.spec_from_file_location("official_dsv4", root / "encoding" / "encoding_dsv4.py")
    renderer = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(renderer)
    payload = data["payload"]
    messages = payload["messages"]
    assert messages and messages[0]["role"] == "system"
    # The official renderer accepts OpenAI tools on the system message.
    messages[0] = dict(messages[0], tools=payload.get("tools", []))
    prompt = renderer.encode_messages(messages, thinking_mode="thinking", drop_thinking=False,
                                      reasoning_effort=payload["reasoning_effort"])
    tokenizer = Tokenizer.from_file(str(root / "tokenizer.json"))
    print(len(tokenizer.encode(prompt, add_special_tokens=False).ids))


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        print("tokenizer-error:" + type(error).__name__, file=sys.stderr)
        sys.exit(1)
