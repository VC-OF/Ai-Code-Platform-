package com.bank.identity.repository;

import com.bank.identity.domain.Branch;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import org.springframework.stereotype.Repository;

import java.util.List;
import java.util.Optional;
import java.util.UUID;

@Repository
public interface BranchRepository extends JpaRepository<Branch, UUID> {

    Optional<Branch> findByTenantIdAndCode(UUID tenantId, String code);

    Optional<Branch> findByTenantIdAndIfsc(UUID tenantId, String ifsc);

    List<Branch> findByTenantIdAndStatus(UUID tenantId, String status);

    Page<Branch> findByTenantId(UUID tenantId, Pageable pageable);

    @Query("""
        SELECT b FROM Branch b
        WHERE b.tenantId = :tenantId
          AND (LOWER(b.name) LIKE LOWER(CONCAT('%', :q, '%'))
            OR LOWER(b.code) LIKE LOWER(CONCAT('%', :q, '%'))
            OR LOWER(b.city) LIKE LOWER(CONCAT('%', :q, '%')))
        """)
    Page<Branch> search(@Param("tenantId") UUID tenantId, @Param("q") String q, Pageable pageable);
}
