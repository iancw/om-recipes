#!/usr/bin/env python3

import argparse
import socket
import sys
import threading


def relay(src, dst, label):
    try:
        while True:
            data = src.recv(65536)
            if not data:
                break
            dst.sendall(data)
    except OSError as err:
        print(f"{label}: {err}", flush=True)
    finally:
        for sock in (src, dst):
            try:
                sock.close()
            except OSError:
                pass


def handle_client(client, addr, upstream_host, upstream_port):
    print(f"client connected: {addr[0]}:{addr[1]}", flush=True)
    try:
        upstream = socket.create_connection((upstream_host, upstream_port), timeout=5)
    except OSError as err:
        print(f"upstream connect failed: {err}", flush=True)
        try:
            client.close()
        except OSError:
            pass
        return

    threading.Thread(target=relay, args=(client, upstream, "client->upstream"), daemon=True).start()
    threading.Thread(target=relay, args=(upstream, client, "upstream->client"), daemon=True).start()


def main():
    parser = argparse.ArgumentParser(description="Forward a local TCP port to another host/port.")
    parser.add_argument("--listen-host", default="0.0.0.0")
    parser.add_argument("--listen-port", type=int, default=8080)
    parser.add_argument("--upstream-host", default="127.0.0.1")
    parser.add_argument("--upstream-port", type=int, default=3000)
    args = parser.parse_args()

    try:
        server = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        server.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        server.bind((args.listen_host, args.listen_port))
        server.listen(100)
    except OSError as err:
        print(
            f"bind/listen failed on {args.listen_host}:{args.listen_port}: {err}",
            file=sys.stderr,
            flush=True
        )
        return 1

    print(
        f"listening on {args.listen_host}:{args.listen_port}, forwarding to {args.upstream_host}:{args.upstream_port}",
        flush=True
    )

    while True:
        client, addr = server.accept()
        threading.Thread(
            target=handle_client,
            args=(client, addr, args.upstream_host, args.upstream_port),
            daemon=True
        ).start()


if __name__ == "__main__":
    raise SystemExit(main())
