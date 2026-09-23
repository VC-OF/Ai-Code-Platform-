package com.bank.identity.repository;

import com.bank.identity.domain.User;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import org.springframework.stereotype.Repository;

import java.time.Instant;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

@Repository
public interface UserRepository extends JpaRepository<User, UUID> {

    Optional<User> findByTenantIdAndUsername(UUID tenantId, String username);

    Optional<User> findByTenantIdAndEmail(UUID tenantId, String email);

    Optional<User> findByTenantIdAndPhone(UUID tenantId, String phone);

    boolean existsByTenantIdAndUsername(UUID tenantId, String username);

    boolean existsByTenantIdAndEmail(UUID tenantId, String email);

    Page<User> findByTenantIdAndStatus(UUID tenantId, String status, Pageable pageable);

    Page<User> findByTenantId(UUID tenantId, Pageable pageable);

    @Query("""
        SELECT u FROM User u
        WHERE u.tenantId = :tenantId
          AND (LOWER(u.username) LIKE LOWER(CONCAT('%', :q, '%'))
            OR LOWER(u.email)    LIKE LOWER(CONCAT('%', :q, '%'))
            OR LOWER(u.displayName) LIKE LOWER(CONCAT('%', :q, '%')))
        """)
    Page<User> search(@Param("tenantId") UUID tenantId, @Param("q") String q, Pageable pageable);

    List<User> findByTenantIdAndBranchId(UUID tenantId, UUID branchId);

    @Modifying
    @Query("UPDATE User u SET u.failedLoginCount = :count, u.lockedUntil = :lockedUntil WHERE u.id = :id")
    int updateFailedLoginCount(@Param("id") UUID id,
                               @Param("count") int count,
                               @Param("lockedUntil") Instant lockedUntil);

    @Modifying
    @Query("UPDATE User u SET u.lastLoginAt = :ts, u.lastLoginIp = :ip, u.failedLoginCount = 0, u.lockedUntil = null WHERE u.id = :id")
    int recordLogin(@Param("id") UUID id, @Param("ts") Instant ts, @Param("ip") String ip);
}
