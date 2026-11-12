# Mail Route Timeline: Thunderbird extension
#
#   make          run the tests, then build the .xpi
#   make build    build dist/mailroute-timeline-<version>.xpi
#   make test     run the tests (needs node)
#   make clean    remove dist/
#
# The version comes from src/manifest.json; bump it there before a new build.

NAME    := mailroute-timeline
VERSION := $(shell sed -n 's/.*"version": *"\([^"]*\)".*/\1/p' src/manifest.json)
XPI     := dist/$(NAME)-$(VERSION).xpi
SRC     := $(wildcard src/*)

.PHONY: all build test clean

all: test build

build: $(XPI)

$(XPI): $(SRC)
	@mkdir -p dist
	rm -f $@
	cd src && zip -q -X -r ../$@ . -x '.*'
	@echo "Built $@"

test:
	node --test test/*.test.js

clean:
	rm -rf dist
