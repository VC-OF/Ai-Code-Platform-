package com.bank.platform.domain;

import com.bank.platform.security.encryption.ColumnEncryptor;
import jakarta.persistence.AttributeConverter;
import jakarta.persistence.Converter;
import org.springframework.beans.factory.annotation.Autowired;

/**
 * JPA AttributeConverter that encrypts string columns at rest using
 * AES-256-GCM. The CipherText is stored as base64.
 *
 * <p>Use with {@code @Convert(converter = EncryptedStringConverter.class)} on
 * any sensitive String field (PII, secrets, etc.).
 */
@Converter
public class EncryptedStringConverter implements AttributeConverter<String, String> {

    private static ColumnEncryptor ENCRYPTOR;

    @Autowired
    void setEncryptor(ColumnEncryptor encryptor) {
        ENCRYPTOR = encryptor;
    }

    @Override
    public String convertToDatabaseColumn(String attribute) {
        if (attribute == null) {
            return null;
        }
        if (ENCRYPTOR == null) {
            // Defensive fallback during bootstrap or unit tests without Spring context.
            return attribute;
        }
        return ENCRYPTOR.encrypt(attribute);
    }

    @Override
    public String convertToEntityAttribute(String dbData) {
        if (dbData == null) {
            return null;
        }
        if (ENCRYPTOR == null) {
            return dbData;
        }
        return ENCRYPTOR.decrypt(dbData);
    }
}
