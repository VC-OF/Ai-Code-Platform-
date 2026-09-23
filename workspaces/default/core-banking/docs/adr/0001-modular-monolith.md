# ADR-0001 · Modular Monolith as Starting Topology

- **Status:** Accepted
- **Date:** Phase 1
- **Deciders:** Architecture

## Context

We need to deliver a complete core banking platform fast, with the long-term ability to
scale teams and isolate failures. Microservices from day one would slow delivery and
introduce distributed-transaction complexity around money movement. A pure monolith
would couple modules and make future extraction painful.

## Decision

We start with a **modular monolith** built as a Maven multi-module project. Each module
is a bounded context with its own `domain`, `application`, `infrastructure`, and `api`
packages. The only module that depends on every other one is the `bootstrap` module,
which contains the Spring Boot main class and configuration.

Modules communicate only through their `api` packages (DTOs + ports). An ArchUnit test in
CI enforces this.

## Consequences

- Faster delivery, simpler local dev (`./mvnw spring-boot:run`).
- Single deployable; can be lifted to multiple replicas but shares one DB.
- Clear seams make future extraction to microservices tractable.
- Forces discipline: ArchUnit violations are CI failures.
- We accept that horizontal scaling is process-level until modules are extracted.
