package com.bank.platform.web.error;

import com.bank.platform.audit.AuditService;
import com.bank.platform.security.CurrentUser;
import com.bank.platform.web.requestid.RequestIdFilter;
import jakarta.servlet.http.HttpServletRequest;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.slf4j.MDC;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.dao.OptimisticLockingFailureException;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.security.access.AccessDeniedException;
import org.springframework.security.authentication.BadCredentialsException;
import org.springframework.security.core.AuthenticationException;
import org.springframework.web.bind.MethodArgumentNotValidException;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;
import org.springframework.web.method.annotation.MethodArgumentTypeMismatchException;
import org.springframework.web.servlet.NoHandlerFoundException;

import java.util.List;
import java.util.Map;
import java.util.stream.Collectors;

@RestControllerAdvice
public class GlobalExceptionHandler {

    private static final Logger log = LoggerFactory.getLogger(GlobalExceptionHandler.class);

    private final CurrentUser currentUser;
    private final AuditService audit;

    public GlobalExceptionHandler(CurrentUser currentUser, AuditService audit) {
        this.currentUser = currentUser;
        this.audit = audit;
    }

    @ExceptionHandler(BusinessException.class)
    public ResponseEntity<ProblemDetail> handleBusiness(BusinessException ex, HttpServletRequest req) {
        log.debug("Business exception: code={}, message={}", ex.getCode(), ex.getMessage());
        return problem(ex.getStatus(), ex.getCode(), ex.getMessage(), req);
    }

    @ExceptionHandler(MethodArgumentNotValidException.class)
    public ResponseEntity<ProblemDetail> handleValidation(MethodArgumentNotValidException ex,
                                                          HttpServletRequest req) {
        List<ProblemDetail.FieldViolation> violations = ex.getBindingResult().getFieldErrors().stream()
            .map(fe -> new ProblemDetail.FieldViolation(
                fe.getField(), fe.getDefaultMessage(), fe.getRejectedValue()))
            .collect(Collectors.toList());
        return ResponseEntity.badRequest()
            .contentType(MediaType.APPLICATION_PROBLEM_JSON)
            .body(ProblemDetail.validation("Request body validation failed", violations));
    }

    @ExceptionHandler(MethodArgumentTypeMismatchException.class)
    public ResponseEntity<ProblemDetail> handleTypeMismatch(MethodArgumentTypeMismatchException ex,
                                                            HttpServletRequest req) {
        return problem(HttpStatus.BAD_REQUEST, "INVALID_PARAMETER",
            "Parameter '%s' has invalid value '%s'".formatted(ex.getName(), ex.getValue()), req);
    }

    @ExceptionHandler(NoHandlerFoundException.class)
    public ResponseEntity<ProblemDetail> handleNotFound(NoHandlerFoundException ex,
                                                       HttpServletRequest req) {
        return problem(HttpStatus.NOT_FOUND, "NOT_FOUND", "No handler for " + req.getRequestURI(), req);
    }

    @ExceptionHandler(AccessDeniedException.class)
    public ResponseEntity<ProblemDetail> handleAccessDenied(AccessDeniedException ex,
                                                            HttpServletRequest req) {
        return problem(HttpStatus.FORBIDDEN, "FORBIDDEN", "Access denied", req);
    }

    @ExceptionHandler(BadCredentialsException.class)
    public ResponseEntity<ProblemDetail> handleBadCreds(BadCredentialsException ex,
                                                        HttpServletRequest req) {
        return problem(HttpStatus.UNAUTHORIZED, "BAD_CREDENTIALS", "Invalid username or password", req);
    }

    @ExceptionHandler(AuthenticationException.class)
    public ResponseEntity<ProblemDetail> handleAuth(AuthenticationException ex,
                                                    HttpServletRequest req) {
        return problem(HttpStatus.UNAUTHORIZED, "UNAUTHENTICATED", ex.getMessage(), req);
    }

    @ExceptionHandler(OptimisticLockingFailureException.class)
    public ResponseEntity<ProblemDetail> handleOptimisticLock(OptimisticLockingFailureException ex,
                                                              HttpServletRequest req) {
        return problem(HttpStatus.CONFLICT, "STALE_ENTITY",
            "Entity was modified concurrently, please retry", req);
    }

    @ExceptionHandler(DataIntegrityViolationException.class)
    public ResponseEntity<ProblemDetail> handleDataIntegrity(DataIntegrityViolationException ex,
                                                             HttpServletRequest req) {
        log.warn("Data integrity violation: {}", ex.getMostSpecificCause().getMessage());
        return problem(HttpStatus.CONFLICT, "DATA_INTEGRITY_VIOLATION",
            "Operation violates a data integrity constraint", req);
    }

    @ExceptionHandler(Exception.class)
    public ResponseEntity<ProblemDetail> handleGeneric(Exception ex, HttpServletRequest req) {
        String requestId = MDC.get(RequestIdFilter.MDC_KEY);
        log.error("Unhandled exception [requestId={}]: {}", requestId, ex.getMessage(), ex);
        currentUser.get().ifPresent(u ->
            audit.recordFailure(u.getUserId(), req.getRequestURI(), ex));
        return problem(HttpStatus.INTERNAL_SERVER_ERROR, "INTERNAL_ERROR",
            "An internal error occurred. Please contact support with request id " + requestId, req);
    }

    private ResponseEntity<ProblemDetail> problem(HttpStatus status, String code,
                                                  String detail, HttpServletRequest req) {
        ProblemDetail pd = ProblemDetail.of(status, code, detail, req.getRequestURI());
        return ResponseEntity.status(status)
            .header(HttpHeaders.CONTENT_TYPE, MediaType.APPLICATION_PROBLEM_JSON_VALUE)
            .body(pd);
    }
}
