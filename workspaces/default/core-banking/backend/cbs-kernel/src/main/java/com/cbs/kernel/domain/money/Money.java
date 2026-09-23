package com.cbs.kernel.domain.money;

import com.cbs.kernel.domain.error.ValidationException;
import com.fasterxml.jackson.annotation.JsonCreator;
import com.fasterxml.jackson.annotation.JsonValue;
import jakarta.persistence.Column;
import jakarta.persistence.Embeddable;
import lombok.AccessLevel;
import lombok.EqualsAndHashCode;
import lombok.Getter;
import lombok.NoArgsConstructor;

import java.io.Serializable;
import java.math.BigDecimal;
import java.math.RoundingMode;
import java.util.Currency;
import java.util.Objects;

/**
 * Money value object. All monetary amounts are stored as minor units
 * (e.g. cents) in a BIGINT column to avoid floating point errors.
 *
 * <p>Example: $10.50 USD is stored as 1050 with currency "USD".
 */
@Getter
@EqualsAndHashCode
@Embeddable
@NoArgsConstructor(access = AccessLevel.PROTECTED)
public final class Money implements Serializable, Comparable<Money> {

    private static final long serialVersionUID = 1L;

    @Column(name = "amount_minor", nullable = false)
    private long amountMinor;

    @Column(name = "currency", nullable = false, length = 3)
    private String currency;

    private Money(long amountMinor, String currency) {
        this.amountMinor = amountMinor;
        this.currency = currency;
    }

    @JsonCreator
    public static Money of(long amountMinor, String currencyCode) {
        Objects.requireNonNull(currencyCode, "currencyCode");
        if (currencyCode.length() != 3) {
            throw new ValidationException("Currency code must be ISO 4217 (3 letters): " + currencyCode);
        }
        try {
            Currency.getInstance(currencyCode.toUpperCase());
        } catch (IllegalArgumentException e) {
            throw new ValidationException("Unknown currency: " + currencyCode);
        }
        return new Money(amountMinor, currencyCode.toUpperCase());
    }

    public static Money ofMajor(BigDecimal amount, String currencyCode) {
        Objects.requireNonNull(amount, "amount");
        long minor = amount.setScale(2, RoundingMode.UNNECESSARY)
                .movePointRight(2)
                .longValueExact();
        return of(minor, currencyCode);
    }

    public static Money zero(String currencyCode) {
        return of(0L, currencyCode);
    }

    public BigDecimal toMajor() {
        return BigDecimal.valueOf(amountMinor).movePointLeft(2);
    }

    public Money plus(Money other) {
        assertSameCurrency(other);
        return new Money(Math.addExact(this.amountMinor, other.amountMinor), this.currency);
    }

    public Money minus(Money other) {
        assertSameCurrency(other);
        return new Money(Math.subtractExact(this.amountMinor, other.amountMinor), this.currency);
    }

    public Money negate() {
        return new Money(Math.negateExact(this.amountMinor), this.currency);
    }

    public boolean isPositive() {
        return amountMinor > 0;
    }

    public boolean isNegative() {
        return amountMinor < 0;
    }

    public boolean isZero() {
        return amountMinor == 0;
    }

    @Override
    public int compareTo(Money other) {
        assertSameCurrency(other);
        return Long.compare(this.amountMinor, other.amountMinor);
    }

    private void assertSameCurrency(Money other) {
        if (!this.currency.equals(other.currency)) {
            throw new ValidationException("Currency mismatch: " + this.currency + " vs " + other.currency);
        }
    }

    @JsonValue
    public String serialized() {
        return toMajor().toPlainString() + " " + currency;
    }

    @Override
    public String toString() {
        return toMajor().toPlainString() + " " + currency;
    }
}
