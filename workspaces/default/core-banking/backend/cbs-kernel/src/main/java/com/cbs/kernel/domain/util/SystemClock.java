package com.cbs.kernel.domain.util;

import java.time.Clock;
import java.time.Instant;
import java.time.ZoneId;

/**
 * Application-wide clock. Use this instead of {@code Instant.now()} directly
 * so tests can override the clock.
 */
public final class SystemClock {

    private static volatile Clock clock = Clock.systemUTC();

    private SystemClock() {
    }

    public static Instant now() {
        return clock.instant();
    }

    public static ZoneId zone() {
        return clock.getZone();
    }

    public static void setClock(Clock c) {
        clock = c;
    }
}
