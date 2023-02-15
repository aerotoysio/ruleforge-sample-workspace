# RuleForge Sample Workspace

A self-contained sample workspace for [RuleForge Editor](https://github.com/aerotoysio/ruleforge-editor) — point the editor at this folder and you'll have a node library, a couple of seed rules, and reference tables ready to play with.

## Layout

```
.
├── nodes/                    # Reusable "business intention" node defs
│   ├── node-input.json
│   ├── node-output.json
│   ├── node-iterator.json
│   ├── node-merge.json
│   ├── node-constant.json
│   ├── node-calc.json
│   ├── node-mutator-set.json
│   ├── node-mutator-lookup.json
│   ├── node-rule-ref.json
│   ├── node-count-array.json
│   ├── node-filter-string-in.json
│   ├── node-filter-number-range.json
│   ├── node-filter-date.json
│   ├── node-filter-day-of-week.json
│   ├── node-filter-pax-type.json
│   ├── node-filter-cabin.json          # semantic preset → ref-cabin-classes
│   ├── node-filter-loyalty-tier.json   # semantic preset → loyalty fields
│   └── node-filter-markets.json        # hierarchical markets picker → ref-airports
│
├── rules/                    # Folder per rule
│   ├── offer-tax/
│   │   ├── rule.json                   # DAG: instances + edges + metadata
│   │   ├── schema/{input,output,context}.json
│   │   ├── bindings/[instanceId].json
│   │   └── tests/*.json
│   └── pax-validation/
│       └── …
│
├── refs/                     # Global lookup tables
│   ├── ref-airports.json     # IATA codes with continent / country / state hierarchy
│   ├── ref-cabin-classes.json
│   ├── ref-pax-types.json
│   └── ref-offer-tax-rates.json
│
├── samples/                  # (unused — slated for cleanup)
└── workspace.json            # Workspace metadata
```

## Conceptual model

A RuleForge rule is a DAG of node-instances. Two axes are decoupled on disk:

1. **Global node library** (`/nodes/*.json`) — reusable building blocks. Each captures a *business intention* ("filter by string", "translate code via reference", "iterate passengers"). A node declares its **ports** (inputs / params / outputs) and engine defaults; it doesn't know about any specific rule's schema.

2. **Per-rule bindings** (`/rules/[id]/bindings/[instanceId].json`) — wire each port to an actual JSONPath, literal, reference table, or context key in *this* rule's schema.

The same node can be used in hundreds of rules with totally different shapes — that's the leverage.

## Custom (semantic) nodes

Several seed nodes are **presets of base datatype filters**. They compile down to the engine's existing string-IN evaluator but ship pre-tuned for common authoring patterns:

| Node                       | Underlying       | UX preset                                                                    |
|----------------------------|------------------|------------------------------------------------------------------------------|
| `node-filter-pax-type`     | string-IN        | Source restricted to fields named `paxType`/`ageCategory`. Ref: `ref-pax-types`. |
| `node-filter-cabin`        | string-IN        | Source restricted to fields named `cabin`/`class`. Ref: `ref-cabin-classes`. |
| `node-filter-loyalty-tier` | string-IN        | Source restricted to fields named `tier`/`loyalty`/`level`.                  |
| `node-filter-markets`      | string-IN        | Source restricted to `*location*` fields. Values authored hierarchically against `ref-airports` (continent → country → state → city). |
| `node-filter-day-of-week`  | date filter      | Wraps the calendar-mode date binding pre-set to day-of-week.                 |

## Seed rules

- **`rules/offer-tax/`** — per-pax tax lookup against `ref-offer-tax-rates`. Linear chain: input → iterator → constant shell → mutator-set + 3× mutator-lookup → merge → output.
- **`rules/pax-validation/`** — paxType vs date-of-birth sanity check. Branchy: 3 parallel paxType filters, each gating a number-range filter for the expected age band, then merged.

## Engine compatibility

This workspace uses the new folder-per-rule layout. The engine team is updating the loader (see [aerotoysio/ruleforge#15](https://github.com/aerotoysio/ruleforge/issues/15)). Until that ships, the editor reads/writes this layout but the CLI's `run --fixtures` pointed at this folder will fail on the layout change — the engine still expects the old flat `rule-*.v*.json` shape.

## Pointing the editor at this workspace

In the editor's Settings page, set the workspace root to wherever you cloned this. That's it.
