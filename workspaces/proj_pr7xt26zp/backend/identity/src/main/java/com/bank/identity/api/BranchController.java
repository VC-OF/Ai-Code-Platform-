package com.bank.identity.api;

import com.bank.identity.api.dto.BranchRequest;
import com.bank.identity.api.dto.BranchResponse;
import com.bank.identity.domain.Branch;
import com.bank.identity.service.BranchService;
import com.bank.platform.api.dto.PageRequest;
import com.bank.platform.api.dto.PageResponse;
import com.bank.platform.security.AuthorizationService;
import com.bank.platform.security.CurrentUser;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.validation.Valid;
import org.springframework.data.domain.Page;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.net.URI;
import java.util.UUID;

@RestController
@RequestMapping("/api/v1/branches")
@Tag(name = "Branches", description = "Branch management endpoints")
public class BranchController {

    private final BranchService branches;
    private final AuthorizationService authz;
    private final CurrentUser currentUser;

    public BranchController(BranchService branches, AuthorizationService authz, CurrentUser currentUser) {
        this.branches = branches;
        this.authz = authz;
        this.currentUser = currentUser;
    }

    @GetMapping
    @Operation(summary = "List branches")
    public PageResponse<BranchResponse> list(
            @RequestParam(defaultValue = "0") int page,
            @RequestParam(defaultValue = "20") int size,
            @RequestParam(defaultValue = "createdAt") String sortBy,
            @RequestParam(defaultValue = "asc") String sortDir,
            @RequestParam(required = false) String q) {
        authz.requirePermission("branch.read");
        var user = currentUser.require();
        PageRequest req = new PageRequest(page, size, sortBy, sortDir, q);
        Page<Branch> p = branches.list(user.getTenantId(), q, req.toSpringPageRequest());
        return toPage(p, p.getContent().stream().map(BranchResponse::from).toList());
    }

    @GetMapping("/{id}")
    @Operation(summary = "Get a branch by id")
    public BranchResponse get(@PathVariable UUID id) {
        authz.requirePermission("branch.read");
        return BranchResponse.from(branches.get(id));
    }

    @PostMapping
    @Operation(summary = "Create a branch")
    public ResponseEntity<BranchResponse> create(@Valid @RequestBody BranchRequest req) {
        authz.requirePermission("branch.create");
        var user = currentUser.require();
        Branch saved = branches.create(req.toEntity(user.getTenantId()));
        return ResponseEntity
            .created(URI.create("/api/v1/branches/" + saved.getId()))
            .body(BranchResponse.from(saved));
    }

    @PutMapping("/{id}")
    @Operation(summary = "Update a branch")
    public BranchResponse update(@PathVariable UUID id, @Valid @RequestBody BranchRequest req) {
        authz.requirePermission("branch.update");
        Branch update = req.toEntity(currentUser.require().getTenantId());
        return BranchResponse.from(branches.update(id, update));
    }

    @DeleteMapping("/{id}")
    @Operation(summary = "Soft-delete a branch")
    public ResponseEntity<Void> delete(@PathVariable UUID id) {
        authz.requirePermission("branch.update");
        branches.softDelete(id);
        return ResponseEntity.noContent().build();
    }

    private static <T> PageResponse<T> toPage(Page<?> p, java.util.List<T> mapped) {
        return new PageResponse<>(mapped, p.getTotalElements(), p.getTotalPages(),
            p.getNumber(), p.getSize(), p.hasNext(), p.hasPrevious(),
            new PageResponse.Sort(p.getSort().iterator().next().getProperty(),
                p.getSort().iterator().next().getDirection().name()));
    }
}
