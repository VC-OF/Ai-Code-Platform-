package com.cbs.usermgmt.branch.domain;

import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;

import java.util.Optional;
import java.util.UUID;

@Repository
public interface BranchRepository extends JpaRepository<Branch, UUID> {
    Optional<Branch> findByCode(String code);
    Optional<Branch> findByIfsc(String ifsc);
    boolean existsByCode(String code);
    boolean existsByIfsc(String ifsc);
}
